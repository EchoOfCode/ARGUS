package com.example.argus.filter

/**
 * On-device pre-filter for notification text.
 *
 * Pure Kotlin, zero network calls, runs in milliseconds.
 * Returns true if the text plausibly references a date, time, or meeting.
 * Purpose: protect the Groq free-tier rate limit and battery.
 */
object EventPreFilter {

    // Day names
    private val DAY_PATTERN = Regex(
        """\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b""",
        RegexOption.IGNORE_CASE
    )

    // Relative date words
    private val RELATIVE_DATE_PATTERN = Regex(
        """\b(tomorrow|today|tonight|yesterday|next\s+week|this\s+week|day\s+after\s+tomorrow|next\s+month)\b""",
        RegexOption.IGNORE_CASE
    )

    // Time patterns: 3pm, 3:30pm, 15:00, 3.30 pm, at 3, by 5
    private val TIME_PATTERN = Regex(
        """\b\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?|\b\d{1,2}\s*(am|pm|AM|PM)\b|\b(at|by)\s+\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)?\b""",
        RegexOption.IGNORE_CASE
    )

    // Date patterns: 5th August, Aug 5, 05/08, 2026-08-05
    private val DATE_PATTERN = Regex(
        """\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}\b|\b\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b""",
        RegexOption.IGNORE_CASE
    )

    // Meeting-indicating words
    private val MEETING_KEYWORDS = Regex(
        """\b(meet|meeting|call|appointment|sync|catch\s*up|catchup|standup|stand-up|huddle|schedule|scheduled|interview|doctor|dentist|class|lecture|seminar|webinar|conference|brunch|lunch|dinner|party|event|ceremony|wedding|birthday)\b""",
        RegexOption.IGNORE_CASE
    )

    /**
     * Check if the given text plausibly references an event.
     *
     * Strategy: Return true if there's at least one date/time indicator.
     * A time reference alone is worth sending ("tuesday at 3pm" is enough
     * even without "meeting"). Meeting keywords boost confidence but aren't required.
     */
    fun isPlausibleEvent(text: String): Boolean {
        if (text.isBlank() || text.length < 5) return false

        val hasDay = DAY_PATTERN.containsMatchIn(text)
        val hasRelativeDate = RELATIVE_DATE_PATTERN.containsMatchIn(text)
        val hasTime = TIME_PATTERN.containsMatchIn(text)
        val hasDate = DATE_PATTERN.containsMatchIn(text)
        val hasMeetingKeyword = MEETING_KEYWORDS.containsMatchIn(text)

        // At least one temporal reference required
        val hasTemporalRef = hasDay || hasRelativeDate || hasTime || hasDate

        // Pass if: temporal reference present, OR meeting keyword with any hint
        return hasTemporalRef || (hasMeetingKeyword && text.length > 10)
    }
}
