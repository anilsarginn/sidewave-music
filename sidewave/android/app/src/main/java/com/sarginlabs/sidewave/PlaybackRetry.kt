package com.sarginlabs.sidewave

import androidx.media3.common.C
import androidx.media3.datasource.HttpDataSource
import java.io.IOException

fun playbackApiFailure(error: Throwable): ApiFailure? {
    var current: Throwable? = error
    repeat(12) {
        val value = current ?: return null
        if(value is ApiFailure) return value
        current = value.cause
    }
    return null
}

/** Provider access/removal/auth errors must reach the UI instead of consuming the startup budget. */
fun playbackRetryDelay(error: IOException, errorCount: Int, standardDelay: Long): Long {
    if(playbackApiFailure(error)?.retryable == false || errorCount >= 2) return C.TIME_UNSET
    var current: Throwable? = error
    repeat(12) {
        val value = current ?: return standardDelay
        if(value is HttpDataSource.InvalidResponseCodeException && value.responseCode in listOf(400,401,403,404,410,416)) return C.TIME_UNSET
        current = value.cause
    }
    return standardDelay
}
