package com.example.argus.service

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.example.argus.ArgusApplication
import com.example.argus.data.db.NotificationEntity
import com.example.argus.filter.EventPreFilter
import com.example.argus.network.RetrofitClient
import com.example.argus.data.model.ExtractRequest
import com.example.argus.notification.ConfirmationNotifier
import kotlinx.coroutines.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Notification listener service — FALLBACK mode for when the WhatsApp bridge is offline.
 *
 * Captures notifications from allowlisted apps, runs the on-device pre-filter,
 * and sends plausible event candidates to the AI Brain backend.
 */
class ArgusNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Apps we listen to — only these packages trigger processing */
    private val allowedApps = setOf(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "org.telegram.messenger",
        "org.thunderdog.chalern" // Signal
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName

        // Only process allowlisted apps
        if (packageName !in allowedApps) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val fullText = if (title.isNotEmpty() && text.isNotEmpty()) "$title: $text" else title + text

        if (fullText.isBlank()) return

        Log.d(TAG, "Notification from $packageName: ${fullText.take(80)}")

        val receivedAt = DateTimeFormatter.ISO_OFFSET_DATE_TIME
            .withZone(ZoneId.systemDefault())
            .format(Instant.ofEpochMilli(sbn.postTime))

        // Insert into local DB
        scope.launch {
            val dao = ArgusApplication.instance.database.notificationDao()

            val entity = NotificationEntity(
                sourceApp = packageName,
                notificationText = fullText,
                receivedAt = receivedAt,
                senderName = title,
                status = NotificationEntity.Status.CAPTURED
            )
            val id = dao.insert(entity)

            // Run pre-filter
            if (!EventPreFilter.isPlausibleEvent(fullText)) {
                Log.d(TAG, "Pre-filter rejected: ${fullText.take(50)}")
                dao.updateStatus(id, NotificationEntity.Status.FILTERED)
                return@launch
            }

            Log.d(TAG, "Pre-filter passed, sending to backend: ${fullText.take(50)}")

            // Send to backend for extraction
            try {
                val api = RetrofitClient.getApi(applicationContext)
                val secret = RetrofitClient.getSecret(applicationContext)

                if (secret.isBlank()) {
                    Log.w(TAG, "No ARGUS_SECRET configured, skipping backend call")
                    dao.updateStatus(id, NotificationEntity.Status.ERROR)
                    return@launch
                }

                val response = api.extractEvent(
                    secret = secret,
                    request = ExtractRequest(
                        sourceApp = packageName,
                        notificationText = fullText,
                        receivedAt = receivedAt
                    )
                )

                if (response.isSuccessful) {
                    val result = response.body()
                    if (result != null && result.isEvent) {
                        dao.updateWithExtraction(
                            id = id,
                            status = NotificationEntity.Status.SENT,
                            title = result.title,
                            date = result.date,
                            time = result.time,
                            confidence = result.confidence,
                            result = result.toString()
                        )

                        // Show confirmation notification if confidence is high enough
                        if ((result.confidence ?: 0f) >= 0.7f) {
                            ConfirmationNotifier.showConfirmation(
                                context = applicationContext,
                                notificationId = id,
                                title = result.title ?: "Event",
                                date = result.date ?: "Unknown date",
                                time = result.time,
                                senderName = title
                            )
                        }
                    } else {
                        dao.updateStatus(id, NotificationEntity.Status.FILTERED)
                    }
                } else {
                    Log.e(TAG, "Backend error: ${response.code()}")
                    dao.updateStatus(id, NotificationEntity.Status.ERROR)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Backend call failed", e)
                dao.updateStatus(id, NotificationEntity.Status.ERROR)
                // TODO: Queue for WorkManager retry
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // No action needed on removal
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    companion object {
        private const val TAG = "ArgusListener"
    }
}
