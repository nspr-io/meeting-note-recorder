export const CALENDAR_EVENT_ID_MAX_LENGTH = 50;

export function sanitizeCalendarEventIdForFileName(calendarEventId: string): string {
  return calendarEventId.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, CALENDAR_EVENT_ID_MAX_LENGTH);
}
