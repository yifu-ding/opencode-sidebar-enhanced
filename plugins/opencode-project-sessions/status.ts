/**
 * Manually assigned task status for a session.
 *
 * This is deliberately separate from OpenCode's runtime state (busy / idle /
 * waiting). A session can be idle while its task is still in progress, so the
 * plugin never derives one from the other: only the user changes these.
 */

export const STATUSES = [
  "not-started",
  "in-progress",
  "completed",
  "stopped",
  "urgent",
  "focus",
] as const;

export type SessionStatus = (typeof STATUSES)[number];

/** Theme tone names; `gold` is resolved by the renderer, not the theme. */
export type StatusTone = "muted" | "info" | "warning" | "success" | "error" | "gold" | "paused" | "active";

export type StatusMeta = {
  readonly id: SessionStatus;
  /** Single-cell glyph: emoji are double-width and break TUI alignment. */
  readonly glyph: string;
  readonly label: string;
  readonly tone: StatusTone;
};

export const STATUS_META: Readonly<Record<SessionStatus, StatusMeta>> = {
  "not-started": { id: "not-started", glyph: "○", label: "Not started", tone: "muted" },
  "in-progress": { id: "in-progress", glyph: "◐", label: "In progress", tone: "active" },
  // A filled circle reads as finished; green rather than the old blue.
  completed: { id: "completed", glyph: "◉", label: "Completed", tone: "success" },
  stopped: { id: "stopped", glyph: "‖", label: "Stopped", tone: "paused" },
  urgent: { id: "urgent", glyph: "!", label: "Urgent", tone: "error" },
  focus: {
    id: "focus",
    glyph: "★",
    label: "Important",
    tone: "gold",
  },
};

/** Session ID -> status. Absent means "no status set", which is not `not-started`. */
export type StatusMap = Readonly<Record<string, SessionStatus>>;

/**
 * Loosely typed view of the persisted map.
 *
 * The store is plain JSON that survives plugin upgrades, so callers may hold
 * entries written by an older version. Reading such a map must not require a
 * cast at the call site.
 */
export type UnknownStatusMap = Readonly<Record<string, unknown>>;

export function isStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * Reads one entry, ignoring anything unrecognised.
 *
 * A status removed in a later version must never crash the sidebar.
 */
export function statusOf(
  map: UnknownStatusMap | undefined,
  sessionID: string,
): SessionStatus | undefined {
  const value = map?.[sessionID];
  if (isStatus(value)) return value;
  return undefined;
}

export function metaFor(status: SessionStatus | undefined): StatusMeta | undefined {
  return status ? STATUS_META[status] : undefined;
}
