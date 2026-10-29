package com.sarginlabs.sidewave

/** Progress callbacks also run later during semantics/layout, after playback state may change. */
fun progressSnapshot(completed: Double, total: Double): () -> Float {
    val fraction = if(!completed.isFinite() || !total.isFinite() || total <= 0.0) 0f
        else (completed.coerceIn(0.0, total) / total).toFloat()
    return { fraction }
}

fun seekSliderValue(value: Float, durationMs: Long): Float =
    if(!value.isFinite() || durationMs <= 0) 0f else value.coerceIn(0f, durationMs.toFloat())
