// The dish stores its sleep window as minutes after midnight UTC, but the user
// sets it in their own clock — so every read and write crosses a timezone. Kept
// apart from the form because getting this backwards is silent: the control
// still looks right, it just schedules the wrong hour.

/** UTC minutes-after-midnight → local minutes-after-midnight. */
export function utcMinutesToLocalMinutes(utcMinutes: number): number {
  const date = new Date();
  date.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0);
  return date.getHours() * 60 + date.getMinutes();
}

/** Local minutes-after-midnight → UTC minutes-after-midnight, as the dish expects it. */
export function localMinutesToUtcMinutes(localMinutes: number): number {
  const date = new Date();
  date.setHours(Math.floor(localMinutes / 60), localMinutes % 60, 0, 0);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/** Local minutes-after-midnight → "1:00 AM", for display. */
export function formatClock12(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  return `${hour12}:${String(minutes % 60).padStart(2, "0")} ${meridiem}`;
}
