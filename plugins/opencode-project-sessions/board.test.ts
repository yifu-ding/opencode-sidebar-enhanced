import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBoard,
  buildProjectColumns,
  filterBoardCards,
  parseBoardDate,
  columnAt,
  columnBoxes,
  columnOf,
  statusForDrop,
  totalCards,
  visibleColumnKeys,
  UNTRIAGED,
  type BoardCard,
} from "./board.ts";
import { STATUSES } from "./status.ts";

function card(id: string, options: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    title: options.title ?? id,
    project: options.project ?? "proj",
    ...(options.projectKey ? { projectKey: options.projectKey } : {}),
    directory: options.directory ?? "/work/proj",
    activity: options.activity ?? 1,
    ...(options.status ? { status: options.status } : {}),
  };
}

test("empty columns are hidden except while moving a card", () => {
  const board = buildBoard([card("a", { status: "focus" }), card("b")]);
  assert.deepEqual(visibleColumnKeys(board), [UNTRIAGED, "focus"]);
  assert.deepEqual(visibleColumnKeys(board, true), [UNTRIAGED, ...STATUSES]);
  assert.deepEqual(visibleColumnKeys(buildBoard([])), []);
  assert.deepEqual(visibleColumnKeys(buildBoard([card("a", { status: "completed" })])), ["completed"]);
});

test("project mode groups by project key, not status or duplicate names", () => {
  const cards = [
    card("a", { project: "same", projectKey: "one", activity: 10, status: "completed" }),
    card("b", { project: "same", projectKey: "two", activity: 30, status: "focus" }),
    card("c", { project: "same", projectKey: "one", activity: 20 }),
  ];
  const columns = buildProjectColumns(cards);
  assert.deepEqual(columns.map((column) => column.key), ["project:two", "project:one"]);
  assert.deepEqual(columns[1]?.cards.map((card) => card.id), ["c", "a"]);
  assert.equal(columns[1]?.cards[1]?.status, "completed");
  assert.equal(cards[0]?.status, "completed");
});

test("project mode search and fallback directory identity", () => {
  const cards = [card("a", { project: "Alpha", directory: "/a" }), card("b", { project: "Beta", directory: "/b" })];
  assert.deepEqual(buildProjectColumns(cards, { query: " ALPHA " }).map((column) => column.key), ["project:/a"]);
  assert.deepEqual(buildProjectColumns(cards, { query: "missing" }), []);
  assert.deepEqual(buildProjectColumns([]), []);
  const boxes = columnBoxes(buildProjectColumns(cards).map((column) => column.key), 1, 80, 2);
  assert.equal(columnAt(boxes, 1), "project:/a");
});

test("date filters use an inclusive local-day activity boundary", () => {
  const since = parseBoardDate("2026-11-19")!;
  assert.equal(since, new Date(2026, 10, 19).getTime());
  const cards = [card("before", { activity: since - 1 }), card("on", { activity: since }), card("after", { activity: since + 1 })];
  assert.deepEqual(filterBoardCards(cards, { since }).map((card) => card.id), ["on", "after"]);
  assert.equal(filterBoardCards(cards).length, 3);
  assert.equal(filterBoardCards([card("epoch", { activity: 0 })], { since: 0 }).length, 1);
});

test("date input rejects malformed dates and month rollover", () => {
  for (const value of ["", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-11-00", "19/11/2026", "2026-1-1", "not a date"]) {
    assert.equal(parseBoardDate(value), undefined, value);
  }
  assert.equal(parseBoardDate("2024-02-29"), new Date(2024, 1, 29).getTime());
  assert.equal(parseBoardDate(" 2026-11-19 "), new Date(2026, 10, 19).getTime());
});

test("multi-status filters include Untriaged and distinguish none from all", () => {
  const cards = [card("a", { status: "focus" }), card("b", { status: "completed" }), card("c")];
  assert.deepEqual(filterBoardCards(cards, { statuses: ["focus", "untriaged"] }).map((card) => card.id), ["a", "c"]);
  assert.deepEqual(filterBoardCards(cards, { statuses: [] }), []);
  assert.equal(filterBoardCards(cards).length, 3);
});

test("date, multiple statuses, and search intersect identically in both modes", () => {
  const since = parseBoardDate("2026-11-19")!;
  const cards = [
    card("a", { activity: since, title: "Draft", projectKey: "one", status: "focus" }),
    card("b", { activity: since + 1, title: "Draft", projectKey: "two", status: "completed" }),
    card("old", { activity: since - 1, title: "Draft", status: "focus" }),
    card("wrong-status", { activity: since + 1, title: "Draft", status: "urgent" }),
    card("wrong-query", { activity: since + 1, title: "Other", status: "focus" }),
  ];
  const options = { since, query: "draft", statuses: ["focus", "completed"] as const };
  const byStatus = buildBoard(cards, options);
  const byProject = buildProjectColumns(cards, options);
  assert.equal(totalCards(byStatus), 2);
  assert.deepEqual(byProject.flatMap((column) => column.cards).map((card) => card.id).sort(), ["a", "b"]);
  assert.equal(cards.length, 5);
});

test("every status gets a column even when empty", () => {
  const board = buildBoard([]);
  // A column that vanishes when emptied cannot be dropped onto, so the set of
  // columns must be fixed by the vocabulary, not by the data.
  assert.deepEqual(board.columns.map((column) => column.status), [...STATUSES]);
  assert.equal(board.untriaged.length, 0);
});

test("buckets cards by status and leaves unset ones untriaged", () => {
  const board = buildBoard([
    card("a", { status: "in-progress" }),
    card("b", { status: "completed" }),
    card("c"),
    card("d", { status: "urgent" }),
  ]);

  assert.deepEqual(columnOf(board, "in-progress").map((c) => c.id), ["a"]);
  assert.deepEqual(columnOf(board, "completed").map((c) => c.id), ["b"]);
  assert.deepEqual(columnOf(board, "urgent").map((c) => c.id), ["d"]);
  assert.deepEqual(board.untriaged.map((c) => c.id), ["c"]);
  assert.equal(totalCards(board), 4);
});

test("sorts each column newest first", () => {
  const board = buildBoard([
    card("old", { status: "focus", activity: 10 }),
    card("new", { status: "focus", activity: 99 }),
    card("mid", { status: "focus", activity: 50 }),
  ]);
  assert.deepEqual(columnOf(board, "focus").map((c) => c.id), ["new", "mid", "old"]);
});

test("search narrows every column and the tray", () => {
  const board = buildBoard(
    [
      card("a", { status: "completed", title: "Rebuttal draft" }),
      card("b", { status: "in-progress", title: "Unrelated" }),
      card("c", { title: "Loose rebuttal" }),
    ],
    { query: "rebuttal" },
  );
  assert.deepEqual(columnOf(board, "completed").map((c) => c.id), ["a"]);
  assert.deepEqual(columnOf(board, "in-progress"), []);
  assert.deepEqual(board.untriaged.map((c) => c.id), ["c"]);
});

test("search matches project and directory too", () => {
  const board = buildBoard(
    [card("a", { status: "focus", title: "x", project: "vault", directory: "/Users/me/vault" })],
    { query: "vault" },
  );
  assert.equal(columnOf(board, "focus").length, 1);
});

test("dropping on the tray clears the status, dropping on a column sets it", () => {
  assert.equal(statusForDrop("completed"), "completed");
  assert.equal(statusForDrop("focus"), "focus");
  // Clearing is a real outcome: the card leaves the board without being deleted.
  assert.equal(statusForDrop(UNTRIAGED), null);
});

test("column boxes tile the width and leave symmetric gutters", () => {
  const boxes = columnBoxes(["focus", "stopped", "urgent"], 0, 30, 2);
  // 30 wide with two 2-column gutters leaves 26 for three columns of 8.
  assert.deepEqual(boxes.map((b) => b.left), [0, 10, 20]);
  assert.equal(boxes[0]?.right, 7);
  assert.equal(boxes[1]?.right, 17);
  assert.equal(boxes[2]?.right, 29);
});

test("the last column absorbs the remainder so the row fills the width", () => {
  // 31 is not divisible by 3; without the remainder the right edge would drift.
  const boxes = columnBoxes(["focus", "stopped", "urgent"], 0, 31, 2);
  assert.equal(boxes[2]?.right, 30);
});

test("hit-testing resolves a column and never falls in a gutter", () => {
  const boxes = columnBoxes(["focus", "stopped", "urgent"], 0, 30, 2);
  assert.equal(columnAt(boxes, 4), "focus");
  assert.equal(columnAt(boxes, 15), "stopped");
  assert.equal(columnAt(boxes, 25), "urgent");
  // 9 is the gutter between a and b.
  assert.ok(columnAt(boxes, 9) !== undefined);
  // Far outside still resolves to the nearest column rather than dropping the card.
  assert.equal(columnAt(boxes, -50), "focus");
  assert.equal(columnAt(boxes, 500), "urgent");
});

test("columnBoxes handles a single column and an empty key list", () => {
  const one = columnBoxes(["focus"], 5, 20, 2);
  assert.deepEqual(one, [{ key: "focus", left: 5, right: 24 }]);
  assert.deepEqual(columnBoxes([], 0, 20, 2), []);
});
test("columnBoxes reports edges that yield the correct visible width", () => {
  // The board sizes a column header from right-left+1, so the edges must be
  // inclusive; an off-by-one truncates every label by a cell.
  const boxes = columnBoxes(["a", "b", "c"] as never, 1, 160, 2);
  const widths = boxes.map((box) => box.right - box.left + 1);
  // Three equal columns plus two gutters must fill the 160-cell span exactly.
  assert.equal(widths.reduce((sum, w) => sum + w, 0) + 2 * 2, 160);
});
