package com.example.argus.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Represents a captured notification or event in the local database.
 *
 * This entity tracks the full lifecycle: captured → filtered → sent to backend →
 * confirmed/ignored by user.
 */
@Entity(tableName = "notifications")
data class NotificationEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    /** Android package name of the source app (e.g., com.whatsapp) */
    val sourceApp: String,

    /** Raw notification text (title + body) */
    val notificationText: String,

    /** ISO 8601 timestamp when the notification was received */
    val receivedAt: String,

    /** Current status in the pipeline */
    val status: String = Status.CAPTURED,

    /** JSON string of extraction result from the backend (nullable) */
    val extractionResult: String? = null,

    /** Sender name extracted from notification title (for WhatsApp) */
    val senderName: String? = null,

    /** Extracted event title */
    val eventTitle: String? = null,

    /** Extracted event date (YYYY-MM-DD) */
    val eventDate: String? = null,

    /** Extracted event time (HH:MM) */
    val eventTime: String? = null,

    /** Extraction confidence (0.0-1.0) */
    val confidence: Float? = null,

    /** Whether this notification had a reply action available */
    val hasReplyAction: Boolean = false,

    /** Whether a confirmation reply was sent back */
    val replySent: Boolean = false,

    /** Timestamp when this row was created */
    val createdAt: Long = System.currentTimeMillis(),

    /** Timestamp when this row was last updated */
    val updatedAt: Long = System.currentTimeMillis()
) {
    object Status {
        const val CAPTURED = "captured"
        const val FILTERED = "filtered"
        const val SENT = "sent"
        const val CONFIRMED = "confirmed"
        const val IGNORED = "ignored"
        const val ERROR = "error"
    }
}
