package com.example.argus.receiver

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import com.example.argus.ArgusApplication
import com.example.argus.calendar.CalendarWriter
import com.example.argus.data.db.NotificationEntity
import com.example.argus.ui.EditEventActivity
import kotlinx.coroutines.*

/**
 * Receives and handles actions from event confirmation notifications.
 *
 * Yes → writes to CalendarContract, marks confirmed
 * Edit → opens EditEventActivity
 * Ignore → marks ignored, dismisses
 */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val notificationId = intent.getLongExtra(EXTRA_NOTIFICATION_ID, -1)
        if (notificationId == -1L) return

        Log.d(TAG, "Action received: ${intent.action} for notification $notificationId")

        // Dismiss the notification
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(notificationId.toInt())

        when (intent.action) {
            ACTION_YES -> handleYes(context, notificationId)
            ACTION_IGNORE -> handleIgnore(context, notificationId)
            ACTION_EDIT -> handleEdit(context, notificationId)
        }
    }

    private fun handleYes(context: Context, notificationId: Long) {
        CoroutineScope(Dispatchers.IO).launch {
            val dao = ArgusApplication.instance.database.notificationDao()
            val entity = dao.getById(notificationId) ?: return@launch

            // Write to calendar
            val eventId = CalendarWriter.writeEvent(
                context = context,
                title = entity.eventTitle ?: "Event",
                date = entity.eventDate ?: return@launch,
                time = entity.eventTime,
                description = "Added by ARGUS from ${entity.sourceApp}\n\nOriginal: ${entity.notificationText}"
            )

            if (eventId != null) {
                dao.updateStatus(notificationId, NotificationEntity.Status.CONFIRMED)
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "✅ Added to calendar: ${entity.eventTitle}", Toast.LENGTH_SHORT).show()
                }
                Log.i(TAG, "Event written to calendar: ${entity.eventTitle} (calendar ID: $eventId)")
            } else {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "⚠️ Failed to write to calendar", Toast.LENGTH_SHORT).show()
                }
                Log.e(TAG, "Failed to write event to calendar")
            }
        }
    }

    private fun handleIgnore(context: Context, notificationId: Long) {
        CoroutineScope(Dispatchers.IO).launch {
            val dao = ArgusApplication.instance.database.notificationDao()
            dao.updateStatus(notificationId, NotificationEntity.Status.IGNORED)
            Log.i(TAG, "Event ignored: $notificationId")
        }
    }

    private fun handleEdit(context: Context, notificationId: Long) {
        val editIntent = Intent(context, EditEventActivity::class.java).apply {
            putExtra(EditEventActivity.EXTRA_NOTIFICATION_ID, notificationId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(editIntent)
    }

    companion object {
        const val ACTION_YES = "com.yusuf.argus.ACTION_YES"
        const val ACTION_IGNORE = "com.yusuf.argus.ACTION_IGNORE"
        const val ACTION_EDIT = "com.yusuf.argus.ACTION_EDIT"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        private const val TAG = "ArgusReceiver"
    }
}
