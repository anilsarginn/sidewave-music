package com.sarginlabs.sidewave

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.graphics.*
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.media3.common.util.UnstableApi
import com.sarginlabs.sidewave.api.Parca
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.TimeUnit
import kotlin.math.max

/** Only opaque account-scoped IDs cross the car boundary; URLs and session cookies stay on the phone. */
@UnstableApi
internal object CarArtwork {
    private val locks=Array(16){Any()}
    fun scope(repo:Repository)=digest(repo.base+"\n"+repo.prefs.getString("member-id","offline")).take(24)
    fun palette(key:String)=listOf("#486D9C","#8765A6","#AB6255","#347B70","#9D773F","#6E68AB")[((key.hashCode().toLong() and 0x7fffffff)%6).toInt()]
    private fun register(repo:Repository,key:String,data:JSONObject):Uri {
        val account=scope(repo);val hash=digest(key);val cacheKey="car-art:$account:$hash"
        if(repo.cached(cacheKey)?.toString()!=data.toString())repo.save(cacheKey,data)
        return Uri.parse("content://${repo.context.packageName}.car-art/v1/$account/$hash")
    }
    fun trackUri(repo:Repository,track:Parca):Uri {
        repo.saveTrack(track)
        // Let a car retry an offline/temporary placeholder on a later browse refresh.
        return register(repo,"track:${track.key()}",JSONObject().put("trackKey",track.key())).buildUpon().appendQueryParameter("v",(System.currentTimeMillis()/300_000).toString()).build()
    }
    fun tileUri(repo:Repository,key:String,title:String,subtitle:String,color:String):Uri = register(repo,"tile-v2:$key",JSONObject().put("title",title).put("subtitle",subtitle).put("color",color).put("editorial",key.removePrefix("car:editorial:").takeIf{key.startsWith("car:editorial:") && it in sessionIds}))
    private fun identity(repo:Repository,uri:Uri):Pair<String,String> {
        val parts=uri.pathSegments
        require(uri.scheme=="content" && uri.authority=="${repo.context.packageName}.car-art" && (uri.query==null || uri.queryParameterNames==setOf("v") && uri.getQueryParameter("v").orEmpty().matches(Regex("[0-9]{1,16}"))) && uri.fragment==null && parts.size==3 && parts[0]=="v1")
        require(parts[1].matches(Regex("[0-9a-f]{24}")) && parts[2].matches(Regex("[0-9a-f]{64}")) && parts[1]==scope(repo))
        return parts[1] to parts[2]
    }
    fun open(context:Context,uri:Uri):File {
        val repo=context.app.repository;val (account,hash)=identity(repo,uri)
        synchronized(locks[(hash.hashCode() and 0x7fffffff)%locks.size]) {
            val directory=File(context.cacheDir,"car-art").apply{mkdirs()}
            val file=File(directory,"$account-$hash.png")
            if(file.isFile && System.currentTimeMillis()-file.lastModified()<6*60*60*1000)return file
            val data=repo.cached("car-art:$account:$hash") ?: throw FileNotFoundException("Artwork not found")
            val track=data.textOrNull("trackKey")?.let{repo.knownTrack(it)}
            val cover=track?.let{loadTrack(repo,it)}
            val packaged=data.textOrNull("editorial")?.takeIf{it in sessionIds}?.let {id->
                runCatching {
                    repo.context.assets.open("artwork/sessions/$id-v1.webp").use {input->
                        BitmapFactory.decodeStream(input)?.let {bitmap->
                            if(bitmap.width==512 && bitmap.height==512)bitmap
                            else Bitmap.createScaledBitmap(bitmap,512,512,true).also{bitmap.recycle()}
                        }
                    }
                }.getOrNull()
            }
            val bitmap=cover ?: packaged ?: tile(data.textOrNull("title") ?: track?.baslik ?: "Sidewave",data.textOrNull("subtitle") ?: track?.sanatci.orEmpty(),data.textOrNull("color") ?: palette(track?.sanatci.orEmpty()))
            val temp=File.createTempFile("art-",".png",directory)
            try {
                temp.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}
                // Do not publish a response fetched for the account that was just signed out/switched.
                require(scope(repo)==account)
                check(temp.renameTo(file))
                if(track!=null && cover==null)file.setLastModified(System.currentTimeMillis()-6*60*60*1000+30_000)
            } finally {temp.delete();bitmap.recycle()}
            val files=directory.listFiles()?.filter{it.extension=="png"}?.sortedByDescending{it.lastModified()}.orEmpty()
            var bytes=0L
            files.forEachIndexed {index,f->bytes+=f.length();if(f!=file && (index>=192 || bytes>96_000_000))f.delete()}
            return file
        }
    }
    private fun loadTrack(repo:Repository,track:Parca):Bitmap? = runCatching {
        val model=repo.coverModel(track)
        val bytes=if(model is File)model.inputStream().use{readBytes(it)} else {
            if(repo.memberCookies.offline)return null
            val url=repo.coverUrl(track) ?: return null
            val http=repo.http.newBuilder().callTimeout(2500,TimeUnit.MILLISECONDS).build()
            http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { response->
                require(response.isSuccessful && response.header("Content-Type").orEmpty().startsWith("image/"))
                readBytes(requireNotNull(response.body).byteStream())
            }
        }
        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        require(bounds.outWidth in 1..20_000 && bounds.outHeight in 1..20_000 && bounds.outWidth.toLong()*bounds.outHeight<=100_000_000)
        val options=BitmapFactory.Options().apply{inSampleSize=1};while(max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>1024)options.inSampleSize*=2
        val decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.size,options) ?: return null
        val scale=512f/max(decoded.width,decoded.height)
        if(scale>=1f)decoded else Bitmap.createScaledBitmap(decoded,max(1,(decoded.width*scale).toInt()),max(1,(decoded.height*scale).toInt()),true).also{if(it!=decoded)decoded.recycle()}
    }.getOrNull()
    private fun readBytes(input:java.io.InputStream):ByteArray = input.use { source->
        val output=ByteArrayOutputStream();val buffer=ByteArray(16384)
        while(true){val count=source.read(buffer);if(count<0)break;require(output.size()+count<=5_000_000);output.write(buffer,0,count)}
        output.toByteArray()
    }
    /** Original cover artwork, rendered locally, remains available without LAN access. */
    private fun tile(title:String,subtitle:String,color:String):Bitmap {
        val bitmap=Bitmap.createBitmap(512,512,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG);val base=runCatching{Color.parseColor(color)}.getOrDefault(Color.rgb(36,112,77))
        paint.shader=LinearGradient(0f,0f,512f,512f,intArrayOf(base,Color.rgb(Color.red(base)/3,Color.green(base)/3,Color.blue(base)/3)),null,Shader.TileMode.CLAMP)
        canvas.drawRect(0f,0f,512f,512f,paint);paint.shader=null
        paint.color=Color.argb(35,255,255,255);paint.style=Paint.Style.STROKE;paint.strokeWidth=18f
        repeat(5){canvas.drawCircle(414f,116f,64f+it*29,paint)};paint.style=Paint.Style.FILL
        paint.color=Color.argb(180,255,255,255);paint.typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);paint.textSize=17f
        canvas.drawText("SIDEWAVE",34f,49f,paint)
        // A small, recognizable sound mark keeps generated list covers in the same family as the app icon.
        paint.strokeWidth=6f;paint.strokeCap=Paint.Cap.ROUND
        repeat(5){i->val h=if(i==2)18f else if(i%2==0)7f else 13f;canvas.drawLine(40f+i*12,114f-h,40f+i*12,114f+h,paint)}
        paint.strokeCap=Paint.Cap.BUTT
        paint.color=Color.WHITE;paint.typeface=Typeface.create("sans-serif-black",Typeface.BOLD);paint.textSize=48f
        val lines=wrap(title,paint,440f,3)
        val first=382f-(lines.size-1)*55f
        lines.forEachIndexed{i,line->canvas.drawText(line,34f,first+i*55f,paint)}
        paint.typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);paint.textSize=18f;paint.color=Color.argb(210,255,255,255)
        canvas.drawText(android.text.TextUtils.ellipsize(subtitle,android.text.TextPaint(paint),440f,android.text.TextUtils.TruncateAt.END).toString(),34f,465f,paint)
        return bitmap
    }
    private fun wrap(text:String,paint:Paint,width:Float,maxLines:Int):List<String> {
        val lines=mutableListOf<String>();var rest=text.trim()
        while(rest.isNotEmpty() && lines.size<maxLines) {
            if(lines.size==maxLines-1){lines+=android.text.TextUtils.ellipsize(rest,android.text.TextPaint(paint),width,android.text.TextUtils.TruncateAt.END).toString();break}
            var count=paint.breakText(rest,true,width,null).coerceAtLeast(1)
            if(count<rest.length)rest.lastIndexOf(' ',count).takeIf{it>0}?.let{count=it}
            lines+=rest.take(count).trim();rest=rest.drop(count).trim()
        }
        return lines
    }
}

/** Car launchers read artwork without first opening a browser connection. Only verified media/system readers are allowed. */
@UnstableApi
class CarArtworkProvider:ContentProvider() {
    override fun onCreate()=true
    override fun getType(uri:Uri)="image/png"
    private fun checkReader() {
        val uid=android.os.Binder.getCallingUid()
        if(uid==android.os.Process.myUid() || uid==android.os.Process.SYSTEM_UID || uid==0)return
        val ctx=requireNotNull(context);val packages=(ctx.packageManager.getPackagesForUid(uid).orEmpty().toList()+listOfNotNull(callingPackage)).distinct()
        val manager=ctx.getSystemService(android.media.session.MediaSessionManager::class.java)
        val trusted=packages.any {pkg->
            pkg=="com.google.android.projection.gearhead" ||
                manager.isTrustedForMediaControl(android.media.session.MediaSessionManager.RemoteUserInfo(pkg,android.os.Binder.getCallingPid(),uid)) ||
                ctx.packageManager.checkSignatures("android",pkg)==android.content.pm.PackageManager.SIGNATURE_MATCH
        }
        if(!trusted)throw FileNotFoundException("Kapak okuyucusu desteklenmiyor")
    }
    override fun openFile(uri:Uri,mode:String):ParcelFileDescriptor {
        checkReader()
        if(mode!="r")throw FileNotFoundException("Salt okunur kapak")
        val file=try{CarArtwork.open(requireNotNull(context),uri)}catch(e:Exception){throw FileNotFoundException("Could not open artwork").apply{initCause(e)}}
        return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun query(uri:Uri,projection:Array<out String>?,selection:String?,selectionArgs:Array<out String>?,sortOrder:String?):Cursor?=null
    override fun insert(uri:Uri,values:ContentValues?):Uri?=throw UnsupportedOperationException()
    override fun delete(uri:Uri,selection:String?,selectionArgs:Array<out String>?):Int=throw UnsupportedOperationException()
    override fun update(uri:Uri,values:ContentValues?,selection:String?,selectionArgs:Array<out String>?):Int=throw UnsupportedOperationException()
}
