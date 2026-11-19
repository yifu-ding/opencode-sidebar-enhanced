import { STATUSES, STATUS_META, type SessionStatus } from "./status.ts";

/**
 * Board layout rules for the full-screen kanban view.
 *
 * Kept free of JSX so the column model, hit-testing and drag resolution can be
 * unit tested without a renderer.
 */

/** A session as the board needs it: identity, label, and where it came from. */
export type BoardCard = {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly projectKey?: string;
  readonly directory: string;
  readonly activity: number;
  readonly status?: SessionStatus;
};

export type BoardColumn = {
  readonly status: SessionStatus;
  readonly glyph: string;
  readonly label: string;
  readonly cards: readonly BoardCard[];
};

export type Board = {
  readonly columns: readonly BoardColumn[];
  /** Cards that carry no status yet; they belong to no column. */
  readonly untriaged: readonly BoardCard[];
};

export const UNTRIAGED = "untriaged" as const;

/** Either a real column or the untriaged tray. */
export type ColumnKey = SessionStatus | typeof UNTRIAGED;

export type BoardMode = "status" | "project";
export type ViewColumn = {
  readonly key: string;
  readonly label: string;
  readonly glyph: string;
  readonly status?: SessionStatus;
  readonly cards: readonly BoardCard[];
};

/** Project columns use stable project identity, never a possibly duplicated name. */
export function buildProjectColumns(cards: readonly BoardCard[], options: BoardOptions = {}): readonly ViewColumn[] {
  const groups = new Map<string, { label: string; cards: BoardCard[] }>();
  for (const card of filterBoardCards(cards, options)) {
    const key = `project:${card.projectKey ?? card.directory}`;
    const group = groups.get(key) ?? { label: card.project || "No project", cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({
    key, label: group.label, glyph: "▦",
    cards: group.cards.toSorted((a, b) => b.activity - a.activity || a.id.localeCompare(b.id)),
  })).toSorted((a, b) => (b.cards[0]?.activity ?? 0) - (a.cards[0]?.activity ?? 0) || a.key.localeCompare(b.key));
}

export type BoardOptions = {
  /** Case-insensitive match against title, project, and directory. */
  readonly query?: string;
  /** Inclusive local-midnight boundary, applied to recent session activity. */
  readonly since?: number;
  /** Omitted means all statuses; an empty array deliberately matches nothing. */
  readonly statuses?: readonly ColumnKey[];
};

export type BoardFilters = {
  readonly date: string;
  readonly statuses: readonly ColumnKey[];
};

export const ALL_BOARD_STATUSES: readonly ColumnKey[] = [UNTRIAGED, ...STATUSES];

/** Strict YYYY-MM-DD parsing. Invalid dates must not silently roll into another month. */
export function parseBoardDate(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.getTime();
}

/** Shared by both modes so changing grouping never changes the selected sessions. */
export function filterBoardCards(cards: readonly BoardCard[], options: BoardOptions = {}): readonly BoardCard[] {
  const needle = options.query?.trim().toLowerCase() ?? "";
  return cards.filter((card) =>
    (!needle || matches(needle, card)) &&
    (options.since === undefined || card.activity >= options.since) &&
    (options.statuses === undefined || options.statuses.includes(card.status ?? UNTRIAGED)),
  );
}

function matches(needle: string, card: BoardCard) {
  return [card.title, card.project, card.directory].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/**
 * Buckets cards into one column per status, newest first.
 *
 * Every status always yields a column, even an empty one: a board whose columns
 * appear and disappear as cards move is disorienting and makes dropping onto an
 * emptied column impossible.
 */
export function buildBoard(cards: readonly BoardCard[], options: BoardOptions = {}): Board {
  const visible = filterBoardCards(cards, options);

  const byStatus = new Map<SessionStatus, BoardCard[]>();
  const untriaged: BoardCard[] = [];
  for (const card of visible) {
    // An unknown or cleared status leaves the card untriaged rather than
    // inventing a column for it.
    if (!card.status) {
      untriaged.push(card);
      continue;
    }
    const bucket = byStatus.get(card.status) ?? [];
    bucket.push(card);
    byStatus.set(card.status, bucket);
  }

  const newestFirst = (left: BoardCard, right: BoardCard) =>
    right.activity - left.activity || left.id.localeCompare(right.id);

  return {
    columns: STATUSES.map((status) => ({
      status,
      glyph: STATUS_META[status].glyph,
      label: STATUS_META[status].label,
      cards: (byStatus.get(status) ?? []).toSorted(newestFirst),
    })),
    untriaged: untriaged.toSorted(newestFirst),
  };
}

/** Reads one column of a board by key, treating the tray like any other. */
export function columnOf(board: Board, key: ColumnKey): readonly BoardCard[] {
  if (key === UNTRIAGED) return board.untriaged;
  return board.columns.find((column) => column.status === key)?.cards ?? [];
}

/** Empty columns are only needed as targets while a card is being moved. */
export function visibleColumnKeys(board: Board, moving = false): readonly ColumnKey[] {
  return [
    ...(moving || board.untriaged.length ? [UNTRIAGED] : []),
    ...board.columns
      .filter((column) => moving || column.cards.length > 0)
      .map((column) => column.status),
  ];
}

export function totalCards(board: Board): number {
  return (
    board.untriaged.length +
    board.columns.reduce((sum, column) => sum + column.cards.length, 0)
  );
}

/**
 * Resolves a drop to the status the card should take.
 *
 * Dropping on the untriaged tray clears the status, which is how a card leaves
 * the board's classification without being deleted.
 */
export function statusForDrop(key: ColumnKey): SessionStatus | null {
  return key === UNTRIAGED ? null : key;
}

/**
 * One column's horizontal extent, used for hit-testing a dropped card.
 *
 * Columns share the width evenly and are separated by a gutter, so a drop
 * resolves to exactly one column even when the pointer lands on the gutter.
 */
export type ColumnBox<Key extends string = ColumnKey> = {
  readonly key: Key;
  readonly left: number;
  readonly right: number;
};

export function columnBoxes<Key extends string>(
  keys: readonly Key[],
  originX: number,
  width: number,
  gap: number,
): readonly ColumnBox<Key>[] {
  if (keys.length === 0) return [];
  const usable = width - gap * (keys.length - 1);
  const each = Math.floor(usable / keys.length);
  const boxes: ColumnBox<Key>[] = [];
  let x = originX;
  for (const [index, key] of keys.entries()) {
    // The last column absorbs the remainder so the row always fills the width.
    const isLast = index === keys.length - 1;
    const columnWidth = isLast ? originX + width - x : each;
    boxes.push({ key, left: x, right: x + columnWidth - 1 });
    x += columnWidth + gap;
  }
  return boxes;
}

/** Finds the column under an x coordinate, or undefined outside the board. */
export function columnAt<Key extends string>(boxes: readonly ColumnBox<Key>[], x: number): Key | undefined {
  // Gutters are symmetric, so a pointer in one is resolved to the nearer column
  // instead of being treated as a miss.
  let best: { key: Key; distance: number } | undefined;
  for (const box of boxes) {
    if (x >= box.left && x <= box.right) return box.key;
    const distance = x < box.left ? box.left - x : x - box.right;
    if (!best || distance < best.distance) best = { key: box.key, distance };
  }
  return best?.key;
}
