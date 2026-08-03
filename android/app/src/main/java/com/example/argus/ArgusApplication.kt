package com.example.argus

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.example.argus.data.db.AppDatabase

class ArgusApplication : Application() {

    lateinit var database: AppDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        database = AppDatabase.getInstance(this)
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        // Channel for event confirmation notifications
        val confirmChannel = NotificationChannel(
            CHANNEL_EVENT_CONFIRM,
            "Event Confirmations",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications asking you to confirm detected calendar events"
        }

        // Channel for reminder notifications
        val reminderChannel = NotificationChannel(
            CHANNEL_REMINDERS,
            "Reminders",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Scheduled reminder notifications"
        }

        // Channel for status/debug notifications
        val statusChannel = NotificationChannel(
            CHANNEL_STATUS,
            "Service Status",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Background service status notifications"
        }

        manager.createNotificationChannel(confirmChannel)
        manager.createNotificationChannel(reminderChannel)
        manager.createNotificationChannel(statusChannel)
    }

    companion object {
        const val CHANNEL_EVENT_CONFIRM = "argus_event_confirm"
        const val CHANNEL_REMINDERS = "argus_reminders"
        const val CHANNEL_STATUS = "argus_status"

        lateinit var instance: ArgusApplication
            private set
    }
}
