import path from "node:path";
import type { Context } from "@opencode/plugin/tui/context";
import { statusOf, type SessionStatus, type StatusMap as ManualStatusMap } from "./status.ts";

/**
 * Session data for the sidebar.
 *
 * Deliberately kept free of JSX so the grouping/sorting rules can be reasoned
 * about (and unit tested) without a renderer.
 */

type Client = Context["client"];

/** The wire shape returned by `client.session.list`. */
export type SessionRowData = Awaited<
  ReturnType<Client["session"]["list"]>
>["data"][number];

/** The wire shape returned by `client.project.list`. */
export type ProjectData = Awaited<ReturnType<Client["project"]["list"]>>[number];

export type SessionRow = {
  readonly id: string;
  readonly title: string;
  /** Time the agent last finished; used for sorting and the "3m" label. */
  readonly activity: number;
  readonly created: number;
  readonly running: boolean;
  readonly cost: number;
  /** User-assigned task status, independent of `running`. */
  readonly status?: SessionStatus;
};

export type ProjectGroup = {
  readonly key: string;
  readonly name: string;
  /** Parent directory, only shown when two projects share a name. */
  readonly hint?: string;
  readonly directory: string;
  readonly rows: readonly SessionRow[];
  /** Newest activity across the group, used to sort projects. */
  readonly activity: number;
};

/** One searchable entry: a session together with the project it belongs to. */
export type FlatSession = {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly directory: string;
  readonly activity: number;
  readonly status?: SessionStatus;
};

/**
 * Flattens a snapshot into search results, newest first.
 *
 * Project details ride along on every entry so a caller can label a session
 * without a second lookup against the grouped structure.
 */
export function flatten(snapshot: Snapshot): readonly FlatSession[] {
  return snapshot.groups.flatMap((group) =>
    group.rows.map((row) => ({
      id: row.id,
      title: row.title,
      project: group.name,
      directory: group.directory,
      activity: row.activity,
      status: row.status,
    })),
  );
}

export type Snapshot = {
  readonly groups: readonly ProjectGroup[];
  readonly sessionCount: number;
  readonly projectCount: number;
  /**
   * True when every page was read. The list still renders when false; it just
   * may omit older sessions, and the UI says so instead of pretending.
   */
  readonly complete: boolean;
  readonly error?: string;
};

/** Session status can change while the list is open, without a title/update change. */
export type StatusMap = Readonly<Record<string, boolean>>;

const PAGE_SIZE = 100;
/** Hard stop so a bad cursor can never spin forever. */
const MAX_PAGES = 100;

/**
 * Reads every session from the server in pages.
 *
 * `client.session.list` is the only source that spans projects; `data.session
 * .list()` only holds sessions this TUI process has already touched, so it
 * cannot answer "what exists in my other workspaces".
 */
export async function fetchAllSessions(
  client: Client,
  options: { readonly archived?: boolean } = {},
): Promise<{ sessions: SessionRowData[]; complete: boolean; error?: string }> {
  const sessions: SessionRowData[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let complete = false;
  let error: string | undefined;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await client.session.list({
        limit: PAGE_SIZE,
        cursor,
        archived: options.archived ?? false,
      });
      for (const session of response.data) {
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        sessions.push(session);
      }
      const next = response.cursor?.next ?? undefined;
      if (!next || next === cursor || response.data.length === 0) {
        complete = true;
        break;
      }
      cursor = next;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return { sessions, complete, error };
}

function projectFor(
  projects: ReadonlyMap<string, ProjectData>,
  session: SessionRowData,
): { key: string; name: string; directory: string; loose: boolean } {
  const project = session.projectID ? projects.get(session.projectID) : undefined;
  const loose = !project || project.canonical === "/";
  // Sessions outside a repository all share the "/" root project, so the
  // project's canonical is useless for them; their own directory is the identity.
  const directory = loose
    ? session.location?.directory ?? project?.canonical ?? ""
    : project.canonical;
  // Sessions outside a repository all share the root project, so split those by
  // directory. They are named after the directory, not the shared root project.
  if (loose) {
    return {
      key: `dir:${directory}`,
      name: path.basename(directory) || directory || "Unknown",
      directory,
      loose: true,
    };
  }
  return {
    key: `project:${project.id}`,
    name: project.name || path.basename(directory) || "Unknown",
    directory,
    loose: false,
  };
}

/**
 * Groups sessions by project and sorts both levels newest-first.
 *
 * Time is `updated` rather than `idle`, because a session created but not yet
 * run still needs to appear where the user just made it.
 */
export function buildSnapshot(
  sessions: readonly SessionRowData[],
  projects: readonly ProjectData[],
  options: {
    readonly status?: StatusMap;
    readonly query?: string;
    readonly complete: boolean;
    readonly error?: string;
    /** Manual, user-assigned statuses keyed by session ID. */
    readonly manual?: ManualStatusMap;
    /** When set, only sessions carrying exactly this manual status are listed. */
    readonly only?: SessionStatus | null;
  },
): Snapshot {
  const byID = new Map(projects.map((project) => [project.id, project]));
  const needle = options.query?.trim().toLowerCase() ?? "";
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      directory: string;
      rows: SessionRow[];
      activity: number;
    }
  >();

  for (const session of sessions) {
    const { key, name, directory } = projectFor(byID, session);
    const title = session.title?.trim() || "Untitled";
    if (needle && !matches(needle, title, name, directory)) continue;
    const status = statusOf(options.manual, session.id);
    // Filtering by status is an explicit user choice, so unmatched sessions are
    // hidden rather than shown dimmed.
    if (options.only && status !== options.only) continue;

    const target = groups.get(key) ?? {
      key,
      name,
      directory,
      rows: [],
      activity: 0,
    };
    groups.set(key, target);

    const activity = Math.max(
      session.time.created,
      // Prefer `idle` (the agent last finished) over `updated`, which also moves
      // on restarts and renames and would reshuffle the list for no reason.
      session.time.idle ?? session.time.updated,
    );
    target.rows.push({
      id: session.id,
      title,
      activity,
      created: session.time.created,
      running: options.status?.[session.id] === true,
      cost: session.cost ?? 0,
      status,
    });
    target.activity = Math.max(target.activity, activity);
  }

  // Disambiguate same-named projects by their parent folder.
  const names = new Map<string, number>();
  for (const group of groups.values()) {
    names.set(group.name, (names.get(group.name) ?? 0) + 1);
  }

  let sessionCount = 0;
  const sorted: ProjectGroup[] = [...groups.values()]
    .map((group) => {
      const rows = group.rows.toSorted(
        (left, right) => right.activity - left.activity || left.id.localeCompare(right.id),
      );
      sessionCount += rows.length;
      return {
        key: group.key,
        name: group.name,
        hint:
          (names.get(group.name) ?? 0) > 1 && group.directory
            ? path.dirname(group.directory)
            : undefined,
        directory: group.directory,
        rows,
        activity: group.activity,
      };
    })
    .toSorted(
      (left, right) =>
        right.activity - left.activity || left.name.localeCompare(right.name),
    );

  return {
    groups: sorted,
    sessionCount,
    projectCount: sorted.length,
    complete: options.complete,
    error: options.error,
  };
}

function matches(needle: string, ...values: string[]) {
  return values.some((value) => value.toLowerCase().includes(needle));
}