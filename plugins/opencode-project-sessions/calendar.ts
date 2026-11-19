/** Local civil dates: never round-trip through UTC, including across DST. */
export function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function moveDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function moveMonth(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const last = new Date(next);
  last.setMonth(last.getMonth() + 1, 0);
  next.setDate(Math.min(day, last.getDate()));
  return next;
}

/** Six fixed-height weeks, Monday first. Adjacent-month days remain selectable. */
export function calendarWeeks(month: Date): readonly (readonly Date[])[] {
  const first = new Date(month);
  first.setDate(1);
  const start = moveDate(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => moveDate(start, week * 7 + day)));
}
