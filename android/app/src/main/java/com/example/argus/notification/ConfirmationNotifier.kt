package com.example.argus.notification

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.example.argus.ArgusApplication
import com.yusuf.argus.R
import com.example.argus.receiver.NotificationActionReceiver

/**
 * Creates and shows confirmation notifications for detected events.
 *
 * Shows: Yes (add to calendar) / Edit (open editor) / Ignore (dismiss)
 */
object ConfirmationNotifier {

    fun showConfirmation(
        context: Context,
        notificationId: Long,
        title: String,
        date: String,
        time: String?,
        senderName: String?
    ) {
        val timeStr = if (time != null) formatTime(time) else "All day"
        val sourceStr = if (senderName != null) "from $senderName" else ""

        // Yes action
        val yesIntent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_YES
            putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
        }
        val yesPending = PendingIntent.getBroadcast(
            context,
            notificationId.toInt() * 3,
            yesIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Ignore action
        val ignoreIntent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_IGNORE
            putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
        }
        val ignorePending = PendingIntent.getBroadcast(
            context,
            notificationId.toInt() * 3 + 1,
            ignoreIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Edit action — opens EditEventActivity
        val editIntent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_EDIT
            putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
        }
        val editPending = PendingIntent.getBroadcast(
            context,
            notificationId.toInt() * 3 + 2,
            editIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, ArgusApplication.CHANNEL_EVENT_CONFIRM)
            .setSmallIcon(android.R.drawable.ic_menu_my_calendar)
            .setContentTitle("🗓️ Event detected $sourceStr")
            .setContentText("$title — $date at $timeStr")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("$title\n📅 $date at $timeStr\n\nTap an action to confirm:")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(android.R.drawable.ic_menu_add, "✅ Yes", yesPending)
            .addAction(android.R.drawable.ic_menu_edit, "✏️ Edit", editPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ Ignore", ignorePending)
            .build()

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(notificationId.toInt(), notification)
    }

    private fun formatTime(time: String): String {
        return try {
            val parts = time.split(":")
            val hour = parts[0].toInt()
            val minute = parts[1]
            val period = if (hour >= 12) "PM" else "AM"
            val displayHour = if (hour % 12 == 0) 12 else hour % 12
            "$displayHour:$minute $period"
        } catch (e: Exception) {
            time
        }
    }
}
