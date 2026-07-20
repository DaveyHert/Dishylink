// The dish stores its sleep window as minutes after midnight UTC, but the user
// sets it in their own clock — so every read and write crosses a timezone. Kept
// apart from the form because getting this backwards is silent: the control
// still looks right, it just schedules the wrong hour.

/** UTC minutes-after-midnight → a local "HH:MM" for a time input. */
export function utcMinutesToLocalTime(utcMinutes: number): string {
  const date = new Date();
  date.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Local "HH:MM" → UTC minutes-after-midnight, as the dish expects it. */
export function localTimeToUtcMinutes(localTime: string): number {
  const [hours, minutes] = localTime.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
