import { test } from "node:test";
import assert from "node:assert/strict";
import { projectView, updateArchive, EMPTY_FILTERS } from "./project-view.ts";
import { buildBoard, totalCards } from "./board.ts";
import type { Snapshot } from "./sessions.ts";

const snapshot: Snapshot = { complete: true, sessionCount: 3, projectCount: 2, groups: [
  { key: "p1", name: "same", directory: "/one", activity: 400, rows: [
    { id: "a", title: "Alpha", activity: 400, created: 1, running: false, cost: 0, status: "completed" },
    { id: "b", title: "Beta", activity: 200, created: 1, running: false, cost: 0, status: "in-progress" },
  ] },
  { key: "p2", name: "same", directory: "/two", activity: 300, rows: [
    { id: "c", title: "Gamma", activity: 300, created: 1, running: false, cost: 0 },
  ] },
] };
const empty = { projects: [], sessions: [] };

test("shared sidebar filtering and board counts agree, including zero selections", () => {
  for (const statuses of [EMPTY_FILTERS.statuses, ["in-progress"] as const, []]) {
    const filters = { date: "", statuses };
    const result = projectView(snapshot, filters, empty);
    const cards = snapshot.groups.flatMap((group) => group.rows.map((row) => ({ ...row, project: group.name, directory: group.directory })));
    assert.equal(result.sessionCount, totalCards(buildBoard(cards, { statuses })));
  }
  assert.equal(projectView(snapshot, EMPTY_FILTERS, empty, "Beta").sessionCount, 1);
  assert.equal(snapshot.sessionCount, 3);
});

test("archive hides projects by identity and sessions independently; restore preserves other archives", () => {
  const result = projectView(snapshot, EMPTY_FILTERS, { projects: ["p1"], sessions: [] });
  assert.deepEqual(result.groups.map((group) => group.key), ["p2"]);
  assert.equal(result.sessionCount, 1);
  assert.equal(projectView(snapshot, EMPTY_FILTERS, { projects: [], sessions: ["a"] }).sessionCount, 2);
  const archived = updateArchive(empty, [{ kind: "project", id: "p1" }, { kind: "session", id: "c" }, { kind: "session", id: "a" }], false);
  assert.equal(projectView(snapshot, EMPTY_FILTERS, archived).sessionCount, 0);
  const restored = updateArchive(archived, [{ kind: "project", id: "p1" }, { kind: "session", id: "c" }], true);
  assert.deepEqual(restored.sessions, ["a"]);
  assert.equal(projectView(snapshot, EMPTY_FILTERS, restored).sessionCount, 2);
  assert.deepEqual(empty, { projects: [], sessions: [] });
  assert.equal(updateArchive(archived, [{ kind: "project", id: "p1" }], false).projects.length, 1);
});

test("status sorting keeps projects intact and never mutates source order", () => {
  const result = projectView(snapshot, EMPTY_FILTERS, empty, "", "status");
  assert.deepEqual(result.groups.map((group) => group.key), ["p1", "p2"]);
  assert.deepEqual(result.groups[0]!.rows.map((row) => row.id), ["b", "a"]);
  assert.deepEqual(snapshot.groups[0]!.rows.map((row) => row.id), ["a", "b"]);
});

test("status sorting places unassigned sessions last even when their activity is newest", () => {
  const mixed: Snapshot = { ...snapshot, groups: [{ ...snapshot.groups[0]!, rows: [
    { id: "none", title: "No status", activity: 9999, created: 1, running: false, cost: 0 },
    ...snapshot.groups[0]!.rows,
  ] }] };
  assert.deepEqual(projectView(mixed, EMPTY_FILTERS, empty, "", "status").groups[0]!.rows.map((row) => row.id), ["b", "a", "none"]);
});

test("status sorting uses urgency, importance, active, todo, done, then other statuses", () => {
  const statuses = [undefined, "stopped", "completed", "not-started", "in-progress", "focus", "urgent"] as const;
  const mixed: Snapshot = { ...snapshot, groups: [{ ...snapshot.groups[0]!, rows: statuses.map((status, index) => ({
    id: String(index), title: String(status), activity: 100 - index, created: 1, running: false, cost: 0, status,
  })) }] };
  assert.deepEqual(projectView(mixed, EMPTY_FILTERS, empty, "", "status").groups[0]!.rows.map((row) => row.status),
    ["urgent", "focus", "in-progress", "not-started", "completed", "stopped", undefined]);
});
