package com.sarginlabs.sidewave

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class MemberCookiesTest {
    private fun preferences(): SharedPreferences {
        val values=mutableMapOf<String,Any?>()
        lateinit var editor:SharedPreferences.Editor
        editor=Proxy.newProxyInstance(javaClass.classLoader,arrayOf(SharedPreferences.Editor::class.java)) { _,method,args ->
            when(method.name) {
                "putString" -> {values[args!![0] as String]=args[1];editor}
                "remove" -> {values.remove(args!![0] as String);editor}
                "clear" -> {values.clear();editor}
                "apply" -> null
                "commit" -> true
                else -> editor
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(javaClass.classLoader,arrayOf(SharedPreferences::class.java)) { _,method,args ->
            when(method.name) {
                "getString" -> values[args!![0]] ?: args[1]
                "edit" -> editor
                "getAll" -> values
                "contains" -> values.containsKey(args!![0])
                else -> null
            }
        } as SharedPreferences
    }
    @Test fun sessionSurvivesRestartAndNeverCrossesOriginOrPort() {
        val prefs=preferences();var origin="http://192.168.1.10:4444"
        val jar=MemberCookies(prefs) {origin};val url="$origin/api/auth/login".toHttpUrl()
        val cookie=Cookie.parse(url,"sidewave_music_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600")!!
        jar.saveFromResponse(url,listOf(cookie))
        assertEquals("abc",MemberCookies(prefs){origin}.loadForRequest("$origin/api/stream/track".toHttpUrl()).single().value)
        assertTrue(jar.loadForRequest("http://192.168.1.10:4445/api/stream/track".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("http://example.com/api/stream/track".toHttpUrl()).isEmpty())
        origin="http://192.168.1.13:4444"
        assertTrue(jar.loadForRequest("$origin/api/listeler".toHttpUrl()).isEmpty())
    }
    @Test fun logoutCookieRevokesSavedSession() {
        val jar=MemberCookies(preferences()) {"http://192.168.1.10:4444"};val url="http://192.168.1.10:4444/api/auth/login".toHttpUrl()
        jar.saveFromResponse(url,listOf(Cookie.parse(url,"sidewave_music_session=abc; Path=/; Max-Age=3600")!!))
        jar.saveFromResponse(url,listOf(Cookie.parse(url,"sidewave_music_session=; Path=/; Max-Age=0")!!))
        assertTrue(jar.loadForRequest(url).isEmpty());assertTrue(jar.required)
    }
}
