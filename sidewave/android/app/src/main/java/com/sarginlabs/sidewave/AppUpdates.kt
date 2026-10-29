package com.sarginlabs.sidewave

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.sarginlabs.sidewave.api.AndroidRelease
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.TimeUnit

fun JSONObject.androidRelease(): AndroidRelease {
    val code=getLong("versionCode");val bytes=getLong("sizeBytes")
    require(code in 1 until Int.MAX_VALUE.toLong() && bytes in 1..250L*1024*1024) { "Invalid update size or version." }
    val value=AndroidRelease(getString("packageName"),code.toInt(),getString("versionName"),getInt("minSdk"),bytes.toInt(),getString("sha256"),getString("certificateSha256"),getString("url"),getString("notes"),getString("publishedAt"))
    require(value.packageName=="com.sarginlabs.sidewave" && value.url=="/downloads/sidewave-${value.versionCode}.apk" && value.versionName.length<=60 && value.minSdk in 29..100 && value.notes.length<=4000) { "Invalid update information." }
    require(value.sha256.matches(Regex("[a-f0-9]{64}")) && value.certificateSha256.matches(Regex("[a-f0-9]{64}"))) { "Invalid update signature." }
    Instant.parse(value.publishedAt)
    return value
}

fun fileSha256(file: File): String {
    val hash=MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;hash.update(buffer,0,n)} }
    return hash.digest().joinToString(""){"%02x".format(it)}
}

data class UpdateState(val status:String="idle",val release:AndroidRelease?=null,val downloaded:Long=0,val message:String?=null)

/** Server metadata never substitutes for the installed application's trusted signing certificate. */
class AppUpdates(private val repo:Repository) {
    private val context=repo.context
    private val operation=Mutex()
    private val restored=CompletableDeferred<Unit>()
    private val mutable=MutableStateFlow(UpdateState())
    val state=mutable.asStateFlow()
    private val directory=File(context.filesDir,"app-updates").apply {mkdirs()}
    private var releaseServer:String?=null
    private var lastCheck=0L
    @Suppress("DEPRECATION") private val installed=context.packageManager.getPackageInfo(context.packageName,PackageManager.GET_SIGNING_CERTIFICATES)
    val currentVersionName=installed.versionName.orEmpty()
    val currentVersionCode=installed.longVersionCode
    private val http=repo.http.newBuilder().callTimeout(10,TimeUnit.MINUTES).readTimeout(30,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private fun artifact(release:AndroidRelease)=File(directory,"update-${release.versionCode}-${release.sha256.take(12)}.apk")

    suspend fun restore()=withContext(Dispatchers.IO) {
        try {
            directory.listFiles()?.filter {it.name.endsWith(".part")}?.forEach {it.delete()}
            val saved=repo.cached("android-update")?:return@withContext
            runCatching {
                if(saved.optString("origin")!=repo.base)return@runCatching
                val release=saved.getJSONObject("release").androidRelease()
                if(release.versionCode<=currentVersionCode){directory.listFiles()?.forEach{it.delete()};return@runCatching}
                val file=artifact(release);if(file.exists()){verify(file,release);releaseServer=repo.base;mutable.value=UpdateState("ready",release,file.length(),"Your update is ready to install.")}
            }
        } finally {restored.complete(Unit)}
    }

    suspend fun checkForUpdates(automatic:Boolean=false)=withContext(Dispatchers.IO) {
        restored.await()
        if(automatic && System.currentTimeMillis()-lastCheck<15*60*1000)return@withContext
        if(!operation.tryLock())return@withContext
        val previous=mutable.value
        try {
            lastCheck=System.currentTimeMillis();mutable.value=previous.copy(status="checking",message=null)
            val server=validateServerAddress(repo.base)
            val json=repo.fetchBlocking("/api/v1/android/update")
            val release=json.androidRelease()
            if(repo.base!=server){mutable.value=UpdateState(message="Connection changed. Check for updates again.");return@withContext}
            releaseServer=server
            repo.save("android-update",JSONObject().put("origin",server).put("release",json))
            mutable.value=when {
                release.versionCode<=currentVersionCode -> UpdateState("current",message="You are up to date.")
                release.minSdk>Build.VERSION.SDK_INT -> UpdateState("incompatible",release,message="This update requires a newer Android version.")
                previous.status=="ready" && previous.release?.sha256==release.sha256 && artifact(release).exists() -> previous.copy(message="Your update is ready to install.")
                else -> UpdateState("available",release,message="Sidewave ${release.versionName} is ready.")
            }
        } catch(e:Exception) {
            if(e is CancellationException)throw e
            mutable.value=if(previous.release!=null)previous.copy(message="Could not reach the update server. Use your downloaded update or try again.")
                else UpdateState("unreachable",message=if(e is ApiFailure)e.message else "Could not check for updates. Check your connection.")
        } finally {operation.unlock()}
    }

    suspend fun download()=withContext(Dispatchers.IO) {
        if(!operation.tryLock())return@withContext
        val release=mutable.value.release;var partial:File?=null
        try {
            require(release!=null && release.versionCode>currentVersionCode && release.minSdk<=Build.VERSION.SDK_INT) {"No compatible update is available."}
            require(releaseServer==repo.base) {"Connection changed. Check for updates again."}
            mutable.value=UpdateState("downloading",release)
            val temporary=File(directory,"update-${release.versionCode}.part");partial=temporary;val request=Request.Builder().url(repo.absolute(release.url)).build()
            http.newCall(request).execute().use { response ->
                check(response.isSuccessful) {"Could not download the update."}
                val mime=response.header("Content-Type").orEmpty().substringBefore(';')
                require(mime in listOf("application/vnd.android.package-archive","application/octet-stream")) {"The server did not return a valid APK."}
                val body=response.body?:error("The update file is empty.")
                require(body.contentLength()==-1L || body.contentLength()==release.sizeBytes.toLong()) {"Update size does not match."}
                body.byteStream().use { input -> temporary.outputStream().use { output ->
                    val buffer=ByteArray(65536);var count=0L
                    while(true){currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;count+=n;require(count<=release.sizeBytes){"This update exceeds the expected size."};output.write(buffer,0,n);mutable.value=UpdateState("downloading",release,count)}
                }}
            }
            currentCoroutineContext().ensureActive();verify(temporary,release)
            val target=artifact(release);check(temporary.renameTo(target)) {"Could not save the update."};partial=null
            directory.listFiles()?.filter {it!=target}?.forEach {it.delete()}
            mutable.value=UpdateState("ready",release,target.length(),"Update verified. Ready to install.")
        } catch(e:Exception) {
            mutable.value=UpdateState(if(release!=null)"available" else "idle",release,message=if(e is CancellationException)"Download cancelled. You can try again later." else if(e is IllegalArgumentException)e.message else "Could not download or verify the update. Please try again.")
            if(e is CancellationException)throw e
        } finally {partial?.delete();operation.unlock()}
    }

    @Suppress("DEPRECATION") private fun verify(file:File,release:AndroidRelease) {
        require(file.length()==release.sizeBytes.toLong() && fileSha256(file)==release.sha256) {"This APK is incomplete or has been modified."}
        val apk=context.packageManager.getPackageArchiveInfo(file.path,PackageManager.GET_SIGNING_CERTIFICATES)?:error("Could not read the APK.")
        require(apk.packageName==context.packageName && apk.longVersionCode==release.versionCode.toLong() && apk.longVersionCode>currentVersionCode && apk.versionName==release.versionName && apk.applicationInfo?.minSdkVersion==release.minSdk && release.minSdk<=Build.VERSION.SDK_INT) {"This APK does not match this app or version."}
        fun certificates(info:android.content.pm.PackageInfo)=info.signingInfo?.apkContentsSigners.orEmpty().map {signature->MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString(""){"%02x".format(it)}}.toSet()
        val trusted=certificates(installed)
        val actual=certificates(apk)
        require(trusted.isNotEmpty() && actual==trusted && actual==setOf(release.certificateSha256)) {"This APK has a different signing certificate."}
    }
    suspend fun readyArtifact():File=withContext(Dispatchers.IO) {
        val release=state.value.release?:error("No update has been downloaded.")
        check(state.value.status=="ready");artifact(release).also {verify(it,release)}
    }
}
