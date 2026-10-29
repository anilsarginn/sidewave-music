// Material icon paths: Copyright Google, Apache License 2.0.
// https://github.com/google/material-design-icons/blob/master/LICENSE
package com.sarginlabs.sidewave

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

object MusicIcons {
    val ArrowDownward: ImageVector by lazy { ImageVector.Builder("ArrowDownward", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val ArrowUpward: ImageVector by lazy { ImageVector.Builder("ArrowUpward", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val CloudDownload: ImageVector by lazy { ImageVector.Builder("CloudDownload", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val DeleteOutline: ImageVector by lazy { ImageVector.Builder("DeleteOutline", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val Download: ImageVector by lazy { ImageVector.Builder("Download", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M5,20h14v-2H5V20z M19,9h-4V3H9v6H5l7,7L19,9z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val DownloadDone: ImageVector by lazy { ImageVector.Builder("DownloadDone", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M20.13,5.41 L18.72,4 L9.53,13.19 L5.28,8.95 L3.87,10.36 L9.53,16.02z").toNodes(), fill = SolidColor(Color.Black))
        addPath(PathParser().parsePathString("M5,18h14v2h-14z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val DownloadForOffline: ImageVector by lazy { ImageVector.Builder("DownloadForOffline", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M12,2C6.49,2,2,6.49,2,12s4.49,10,10,10s10-4.49,10-10S17.51,2,12,2z M11,10V6h2v4h3l-4,4l-4-4H11z M17,17H7v-2h10V17z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val FileOpen: ImageVector by lazy { ImageVector.Builder("FileOpen", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M14,2H6C4.9,2,4,2.9,4,4v16c0,1.1,0.89,2,1.99,2H15v-8h5V8L14,2z M13,9V3.5L18.5,9H13z M17,21.66V16h5.66v2h-2.24 l2.95,2.95l-1.41,1.41L19,19.41l0,2.24H17z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val LibraryMusic: ImageVector by lazy { ImageVector.Builder("LibraryMusic", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val MusicNote: ImageVector by lazy { ImageVector.Builder("MusicNote", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val Pause: ImageVector by lazy { ImageVector.Builder("Pause", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M6 19h4V5H6v14zm8-14v14h4V5h-4z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val PlaylistAdd: ImageVector by lazy { ImageVector.Builder("PlaylistAdd", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M14,10H3v2h11V10z M14,6H3v2h11V6z M18,14v-4h-2v4h-4v2h4v4h2v-4h4v-2H18z M3,16h7v-2H3V16z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val QueueMusic: ImageVector by lazy { ImageVector.Builder("QueueMusic", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M15,6H3v2h12V6z M15,10H3v2h12V10z M3,16h8v-2H3V16z M17,6v8.18C16.69,14.07,16.35,14,16,14c-1.66,0-3,1.34-3,3s1.34,3,3,3 s3-1.34,3-3V8h3V6H17z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val Repeat: ImageVector by lazy { ImageVector.Builder("Repeat", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val RepeatOne: ImageVector by lazy { ImageVector.Builder("RepeatOne", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val Shuffle: ImageVector by lazy { ImageVector.Builder("Shuffle", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val SkipNext: ImageVector by lazy { ImageVector.Builder("SkipNext", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
    val SkipPrevious: ImageVector by lazy { ImageVector.Builder("SkipPrevious", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(PathParser().parsePathString("M6 6h2v12H6zm3.5 6l8.5 6V6z").toNodes(), fill = SolidColor(Color.Black))
    }.build() }
}
