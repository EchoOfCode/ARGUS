package com.example.argus.calendar

import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import java.util.Calendar
import java.util.TimeZone

/**
 * Writes events to the device calendar via CalendarContract.
 *
 * Uses the local device calendar — no OAuth, no internet needed for the write itself.
 */
object CalendarWriter {

    /**
     * Write an event to the device's default calendar.
     *
     * @return The URI of the created event, or null on failure.
     */
    fun writeEvent(
        context: Context,
        title: String,
        date: String,      // YYYY-MM-DD
        time: String?,      // HH:MM (24h) or null for all-day
        description: String? = null
    ): Long? {
        return try {
            val calendarId = getDefaultCalendarId(context) ?: return null

            val startMillis = parseDateTime(date, time)
            val endMillis = if (time != null) {
                startMillis + 60 * 60 * 1000 // Default 1 hour duration
            } else {
                startMillis + 24 * 60 * 60 * 1000 // All-day: 1 day
            }

            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, calendarId)
                put(CalendarContract.Events.TITLE, title)
                put(CalendarContract.Events.DTSTART, startMillis)
                put(CalendarContract.Events.DTEND, endMillis)
                put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)

                if (description != null) {
                    put(CalendarContract.Events.DESCRIPTION, description)
                }

                if (time == null) {
                    put(CalendarContract.Events.ALL_DAY, 1)
                }
            }

            val uri = context.contentResolver.insert(
                CalendarContract.Events.CONTENT_URI,
                values
            )

            uri?.lastPathSegment?.toLongOrNull()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * Get the ID of the default local calendar.
     */
    private fun getDefaultCalendarId(context: Context): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY
        )

        val cursor = context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            null,
            null,
            null
        ) ?: return null

        cursor.use {
            // Try to find the primary calendar first
            while (it.moveToNext()) {
                val id = it.getLong(0)
                val isPrimary = it.getInt(1)
                if (isPrimary == 1) return id
            }

            // Fallback to the first calendar
            if (it.moveToFirst()) {
                return it.getLong(0)
            }
        }

        return null
    }

    /**
     * Parse a date and optional time into epoch milliseconds.
     */
    private fun parseDateTime(date: String, time: String?): Long {
        val parts = date.split("-")
        val year = parts[0].toInt()
        val month = parts[1].toInt() - 1 // Calendar months are 0-based
        val day = parts[2].toInt()

        val cal = Calendar.getInstance()
        cal.set(Calendar.YEAR, year)
        cal.set(Calendar.MONTH, month)
        cal.set(Calendar.DAY_OF_MONTH, day)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)

        if (time != null) {
            val timeParts = time.split(":")
            cal.set(Calendar.HOUR_OF_DAY, timeParts[0].toInt())
            cal.set(Calendar.MINUTE, timeParts[1].toInt())
        } else {
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
        }

        return cal.timeInMillis
    }
}
