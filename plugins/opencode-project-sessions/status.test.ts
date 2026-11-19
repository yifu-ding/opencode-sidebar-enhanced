import { test } from "node:test";
import assert from "node:assert/strict";
import { isStatus, metaFor, statusOf, STATUSES, STATUS_META } from "./status.ts";

test("every status has a single-cell glyph and a label", () => {
  for (const status of STATUSES) {
    const meta = STATUS_META[status];
    assert.equal(meta.id, status);
    assert.ok(meta.glyph.length >= 1);
    // Emoji are double-width in a terminal and would misalign every row.
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(meta.glyph), `${status} uses an emoji`);
    assert.ok(meta.label.length > 0);
  }
});

test("statusOf ignores unknown and removed values", () => {
  const map = { a: "focus", b: "retired-status" } as Record<string, string>;
  assert.equal(statusOf(map, "a"), "focus");
  // A value from an older plugin version must not crash the sidebar.
  assert.equal(statusOf(map, "b"), undefined);
  assert.equal(statusOf(map, "missing"), undefined);
  assert.equal(statusOf(undefined, "a"), undefined);
});

test("isStatus accepts only known statuses", () => {
  assert.equal(isStatus("urgent"), true);
  assert.equal(isStatus("URGENT"), false);
  assert.equal(isStatus(undefined), false);
  assert.equal(isStatus(1), false);
});

test("metaFor is undefined when no status is set", () => {
  assert.equal(metaFor(undefined), undefined);
  assert.equal(metaFor("completed")?.label, "Completed");
});

test("the vocabulary matches what the UI documents", () => {
  assert.deepEqual([...STATUSES], [
    "not-started",
    "in-progress",
    "completed",
    "stopped",
    "urgent",
    "focus",
  ]);
  // Completed is a filled circle now; the tick is gone on purpose.
  assert.equal(STATUS_META.completed.glyph, "◉");
  assert.equal(STATUS_META["in-progress"].glyph, "◐");
  assert.equal(STATUS_META.focus.glyph, "★");
  assert.equal(STATUS_META.focus.label, "Important");
  assert.equal(STATUS_META.focus.tone, "gold");
  // Completed should read as success (green), not info (blue).
  assert.equal(STATUS_META.completed.tone, "success");
  assert.ok(!STATUSES.some((s) => STATUS_META[s].glyph === "✓"));
});
