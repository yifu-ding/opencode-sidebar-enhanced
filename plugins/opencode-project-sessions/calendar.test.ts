import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWeeks, dateKey, moveDate, moveMonth } from "./calendar.ts";

test("calendar is six Monday-first weeks across month and year boundaries", () => {
  const weeks = calendarWeeks(new Date(2026, 10, 19));
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0]!.length, 7);
  assert.equal(weeks[0]![0]!.getDay(), 1);
  assert.equal(dateKey(weeks[0]![0]!), "2026-10-26");
  assert.equal(dateKey(weeks[5]![6]!), "2026-12-06");
});
test("month navigation clamps leap days and preserves local dates without mutating", () => {
  const source = new Date(2024, 0, 31);
  assert.equal(dateKey(moveMonth(source, 1)), "2024-02-29");
  assert.equal(dateKey(moveMonth(new Date(2026, 0, 31), 1)), "2026-02-28");
  assert.equal(dateKey(moveMonth(new Date(2026, 11, 31), 1)), "2027-01-31");
  assert.equal(dateKey(moveDate(new Date(2026, 11, 31), 1)), "2027-01-01");
  assert.equal(dateKey(source), "2024-01-31");
});
