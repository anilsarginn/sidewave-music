package com.sarginlabs.sidewave

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONObject

class MemberCookies(private val prefs: SharedPreferences, private val origin: () -> String) : CookieJar {
    var required by mutableStateOf(false)
    var offline by mutableStateOf(false)
    private fun matches(url: HttpUrl) = "${url.scheme}://${url.host}:${url.port}" == runCatching {
        val uri = java.net.URI(origin()); "${uri.scheme}://${uri.host}:${if(uri.port == -1) if(uri.scheme == "https") 443 else 80 else uri.port}"
    }.getOrNull()
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if(!matches(url)) return
        cookies.find { it.name == "sidewave_music_session" }?.let { cookie ->
            if(cookie.expiresAt <= System.currentTimeMillis() || cookie.value.isEmpty()) clear()
            else prefs.edit().putString("member-cookie", cookie.toString()).putString("member-origin",origin()).apply()
        }
    }
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if(!matches(url) || prefs.getString("member-origin",null) != origin()) return emptyList()
        val cookie = prefs.getString("member-cookie",null)?.let { Cookie.parse(url,it) } ?: return emptyList()
        return if(cookie.expiresAt > System.currentTimeMillis()) listOf(cookie) else emptyList()
    }
    fun clear() { offline=false; prefs.edit().remove("member-cookie").remove("member-origin").apply(); required=true }
}

@Composable
fun MembershipEntry(repo: Repository, content: @Composable (String) -> Unit) {
    var checking by remember { mutableStateOf(true) }
    var identity by remember { mutableStateOf<String?>(null) }
    var signup by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var server by remember { mutableStateOf(repo.base) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        if (!repo.prefs.contains("server")) {
            repo.memberCookies.required=true
            error="Enter your Sidewave server address in Connection settings."
            checking=false
            return@LaunchedEffect
        }
        try {
            val user=repo.fetch("/api/auth/me").optJSONObject("user")
            if(user!=null) { identity=user.getString("id"); repo.memberCookies.required=false }
            else repo.memberCookies.required=true
        } catch (_: Exception) {
            // Downloads remain reachable when the home server cannot be reached.
            identity=repo.prefs.getString("member-id",null) ?: "offline"
        } finally { checking=false }
    }
    if(checking) { AppLaunchScreen(); return }
    if(identity!=null && !repo.memberCookies.required) { content(identity!!); return }
    AnimatedMembershipScreen(signup,username,password,confirm,server,error,busy,
        onMode={signup=it;error=""},onUsername={username=it.take(24)},onPassword={password=it.take(128)},onConfirm={confirm=it.take(128)},onServer={server=it},
        onSubmit={
            if(!busy) {
                if(signup && password!=confirm) error="Passwords do not match."
                else {
                    busy=true;error=""
                    scope.launch {
                        try {
                            repo.base=server
                            val user=repo.fetch("/api/auth/"+(if(signup)"signup" else "login"),"POST",JSONObject().put("username",username.trim()).put("password",password)).getJSONObject("user")
                            val id=user.getString("id")
                            val previous=repo.prefs.getString("member-id",null)
                            if(previous!=null && previous!=id) java.io.File(repo.context.filesDir,"library").listFiles()?.forEach { it.delete() }
                            repo.prefs.edit().putString("member-id",id).putString("member-name",user.getString("username")).apply()
                            repo.memberCookies.offline=false;repo.memberCookies.required=false;identity=id;password="";confirm=""
                        } catch(e: Exception) {error=e.message ?: "Could not sign in. Please try again."} finally {busy=false}
                    }
                }
            }
        },onOffline={repo.memberCookies.offline=true;repo.memberCookies.required=false;identity=repo.prefs.getString("member-id",null) ?: "offline"})
}
