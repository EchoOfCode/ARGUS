package com.example.argus.data.model

import com.google.gson.annotations.SerializedName

/** Request body for POST /extract-event */
data class ExtractRequest(
    @SerializedName("source_app") val sourceApp: String,
    @SerializedName("notification_text") val notificationText: String,
    @SerializedName("received_at") val receivedAt: String
)

/** Response body from POST /extract-event */
data class ExtractResponse(
    @SerializedName("is_event") val isEvent: Boolean,
    val title: String?,
    val date: String?,
    val time: String?,
    val confidence: Float?,
    @SerializedName("raw_text") val rawText: String?
)

/** Request for POST /process-message */
data class ProcessMessageRequest(
    @SerializedName("sender_jid") val senderJid: String,
    @SerializedName("message_text") val messageText: String,
    @SerializedName("chat_jid") val chatJid: String,
    val timestamp: String,
    @SerializedName("is_self_chat") val isSelfChat: Boolean = false
)

/** Response from POST /process-message */
data class ProcessMessageResponse(
    val intent: String,
    val confidence: Float,
    @SerializedName("should_respond") val shouldRespond: Boolean,
    @SerializedName("extract_data") val extractData: Map<String, Any?>?
)

/** Simple health check response */
data class HealthResponse(
    val status: String,
    val service: String,
    val version: String
)
