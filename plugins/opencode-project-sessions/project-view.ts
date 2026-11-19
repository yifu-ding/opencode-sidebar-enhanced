import { ALL_BOARD_STATUSES, filterBoardCards, parseBoardDate, type BoardFilters } from "./board.ts";
import type { Snapshot } from "./sessions.ts";

export type Archive = { projects: readonly string[]; sessions: readonly string[] };
export type ArchiveTarget = { kind: "project" | "session"; id: string };
export function updateArchive(value: Archive, targets: readonly ArchiveTarget[], restoring: boolean): Archive {
  const projects = new Set(targets.filter((target) => target.kind === "project").map((target) => target.id));
  const sessions = new Set(targets.filter((target) => target.kind === "session").map((target) => target.id));
  return restoring
    ? { projects: value.projects.filter((id) => !projects.has(id)), sessions: value.sessions.filter((id) => !sessions.has(id)) }
    : { projects: [...new Set([...value.projects, ...projects])], sessions: [...new Set([...value.sessions, ...sessions])] };
}
export const EMPTY_FILTERS: BoardFilters = { date: "", statuses: ALL_BOARD_STATUSES };

/** Project and board views share one selection; open tabs are deliberately independent. */
export function projectView(snapshot: Snapshot, filters: BoardFilters, archive: Archive, query = "", sort: "activity" | "status" = "activity"): Snapshot {
  const groups = snapshot.groups.filter((group) => !archive.projects.includes(group.key)).flatMap((group) => {
    const visible = new Set(filterBoardCards(group.rows.map((row) => ({
      ...row, project: group.name, directory: group.directory,
    })), { query, since: parseBoardDate(filters.date), statuses: filters.statuses }).map((row) => row.id));
    const rows = group.rows.filter((row) => visible.has(row.id) && !archive.sessions.includes(row.id));
    if (!rows.length) return [];
    if (sort === "status") rows.sort((a, b) => rank(a.status) - rank(b.status) || b.activity - a.activity || a.id.localeCompare(b.id));
    return [{ ...group, rows, activity: Math.max(...rows.map((row) => row.activity)) }];
  });
  groups.sort((a, b) => (sort === "status" ? rank(a.rows[0]?.status) - rank(b.rows[0]?.status) : 0)
    || b.activity - a.activity || a.key.localeCompare(b.key));
  return { ...snapshot, groups, projectCount: groups.length, sessionCount: groups.reduce((sum, group) => sum + group.rows.length, 0) };
}

function rank(status: typeof ALL_BOARD_STATUSES[number] | undefined) {
  const priority = ["urgent", "focus", "in-progress", "not-started", "completed", "stopped"];
  const index = status ? priority.indexOf(status) : -1;
  return index < 0 ? priority.length : index;
}
