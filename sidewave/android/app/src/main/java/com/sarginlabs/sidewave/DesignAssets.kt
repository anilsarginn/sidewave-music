package com.sarginlabs.sidewave

internal val sessionIds=setOf("jazz-after-hours","funk-roots","electronic-horizons","slow-motion","guitar-universe","soul-colors","disco-orbit","psychedelic-roots")
internal fun sessionArtwork(id:String):String? = id.takeIf{it in sessionIds}?.let{"file:///android_asset/artwork/sessions/$it-v1.webp"}
internal val signatureBackgrounds=linkedMapOf("midnight-coast" to "Midnight Coast","analog-drift" to "Analog Drift","desert-afterglow" to "Desert Afterglow","deep-orbit" to "Deep Orbit")
internal fun backgroundArtwork(id:String):String? = id.takeIf{it in signatureBackgrounds}?.let{"file:///android_asset/artwork/wallpapers/$it-v1.webp"}

internal fun detailedThumbnail(url:String,size:Int):String {
    val host=runCatching{java.net.URI(url).host}.getOrNull() ?: return url
    if(!Regex("(^|.*\\.)(googleusercontent|ggpht)\\.com").matches(host))return url
    val bounded=size.coerceIn(64,1200)
    return url.replace(Regex("=w\\d+-h\\d+(?=-|$)"),"=w$bounded-h$bounded").replace(Regex("=s\\d+(?=-|$)"),"=s$bounded")
}
