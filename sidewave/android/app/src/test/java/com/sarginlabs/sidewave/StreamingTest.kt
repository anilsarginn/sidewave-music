package com.sarginlabs.sidewave

import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class StreamingTest {
    @Test fun mediaBodyContinuesBeyondTheJsonApiDeadline() {
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val body = "sixteen-seconds!!"
        val worker = thread(isDaemon = true, name = "slow-media-fixture") {
            runCatching {
                server.accept().use { socket ->
                    val input = socket.getInputStream().bufferedReader()
                    while(!input.readLine().isNullOrEmpty()) { }
                    val output = socket.getOutputStream()
                    output.write("HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n".toByteArray())
                    output.flush()
                    for((index, byte) in body.toByteArray().withIndex()) {
                        if(index > 0) Thread.sleep(1100)
                        output.write(byte.toInt()); output.flush()
                    }
                }
            }
        }
        try {
            val client = createMediaHttpClient(createApiHttpClient())
            client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/audio").build()).execute().use {
                assertEquals(body, it.body!!.string())
            }
        } finally { server.close(); worker.interrupt(); worker.join(1000) }
    }
}
