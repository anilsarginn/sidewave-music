// Generated from openapi.json. Run npm run generate:models.
package com.sarginlabs.sidewave.api

data class Parca(
    val id: String,
    val baslik: String,
    val kaynak: String,
    val sanatci: String = "",
    val album: String? = null,
    val sure: Double? = null,
    val kapakId: String? = null,
    val kapakUrl: String? = null,
    val kapak: String? = null,
    val sanatciId: String? = null,
    val albumId: String? = null,
    val bicim: String? = null,
    val bitrate: Double? = null,
    val parcaNo: Int? = null,
    val disk: Int? = null,
    val yil: Int? = null,
    val favori: Boolean = false,
    val entryId: String? = null,
    val appId: String? = null,
    val reason: String? = null,
    val reasonType: String? = null,
)
