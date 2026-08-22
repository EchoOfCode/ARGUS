/**
 * Google Calendar & ICS Link Generator for ARGUS.
 * Creates 1-tap Google Calendar web URLs and standard iCalendar strings.
 */

export function generateGoogleCalendarUrl(
  title: string,
  dateStr: string,
  timeStr: string | null,
  durationMinutes = 60,
  details = "Scheduled via ARGUS AI Assistant"
): string {
  // Format dates into YYYYMMDDTHHmmSSZ or YYYYMMDD for all-day
  const cleanDate = dateStr.replace(/[^0-9]/g, ""); // e.g. 20260823

  let datesParam = "";
  if (timeStr) {
    const cleanTime = timeStr.replace(/[^0-9]/g, "").padEnd(4, "0").substring(0, 4); // e.g. 1600
    const startHour = parseInt(cleanTime.substring(0, 2), 10);
    const startMin = parseInt(cleanTime.substring(2, 4), 10);

    const startDate = new Date();
    startDate.setFullYear(
      parseInt(cleanDate.substring(0, 4), 10),
      parseInt(cleanDate.substring(4, 6), 10) - 1,
      parseInt(cleanDate.substring(6, 8), 10)
    );
    startDate.setHours(startHour, startMin, 0, 0);

    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    const formatUtc = (d: Date) => {
      return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    };

    datesParam = `${formatUtc(startDate)}/${formatUtc(endDate)}`;
  } else {
    // All day event: YYYYMMDD/YYYYMMDD
    datesParam = `${cleanDate}/${cleanDate}`;
  }

  const base = "https://calendar.google.com/calendar/render";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: datesParam,
    details: details,
  });

  return `${base}?${params.toString()}`;
}

export function generateIcsContent(
  title: string,
  dateStr: string,
  timeStr: string | null,
  durationMinutes = 60
): string {
  const cleanDate = dateStr.replace(/[^0-9]/g, "");
  const timeFormatted = timeStr
    ? timeStr.replace(/[^0-9]/g, "").padEnd(4, "0").substring(0, 4) + "00"
    : "090000";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ARGUS//ARGUS AI Assistant//EN",
    "BEGIN:VEVENT",
    `SUMMARY:${title}`,
    `DTSTART:${cleanDate}T${timeFormatted}`,
    `DESCRIPTION:Event created by ARGUS AI Assistant`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
