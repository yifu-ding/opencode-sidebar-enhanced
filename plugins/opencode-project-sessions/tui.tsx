/** @jsxImportSource @opentui/solid */
import { SidebarCard } from "./sidebar-card.tsx";
import { SidebarTodo } from "./sidebar-todo.tsx";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { MouseEvent } from "@opentui/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Board } from "./board.tsx";
import { BoardFilterDialog } from "./board-filters.tsx";
import { ArchiveDialog, type ArchiveTarget } from "./archive-dialog.tsx";
import { type BoardFilters } from "./board.ts";
import { EMPTY_FILTERS, projectView, updateArchive, type Archive } from "./project-view.ts";
import {
  buildSnapshot,
  fetchAllSessions,
  flatten,
  type FlatSession,
  type ProjectData,
  type ProjectGroup,
  type SessionRowData,
  type Snapshot,
} from "./sessions.ts";
import { toneColor } from "./theme.ts";
import {
  isStatus,
  metaFor,
  STATUSES,
  STATUS_META,
  statusOf,
  type SessionStatus,
  type StatusMap as ManualStatusMap,
  type StatusTone,
} from "./status.ts";

/**
 * Global project session sidebar.
 *
 * Lists every session the connected server knows about, not just the open
 * tabs, grouped by project. Clicking a row opens and focuses that session;
 * nothing is ever prompted or re-run.
 */

type Settings = {
  open: boolean;
  todoOpen?: boolean;
  hidden?: boolean;
  todoHidden?: boolean;
  filters?: BoardFilters;
  archive?: Archive;
  sort?: "activity" | "status";
  collapsed: Record<string, boolean>;
  /** When set, only sessions with this manual status are listed. */
  filter?: SessionStatus | null;
};

/** Manual statuses, kept in their own store so restarting never loses them. */
type StatusSettings = {
  byID: Record<string, SessionStatus>;
};

/** How often to re-read time-relative labels ("3m" -> "4m"). */
const CLOCK_MS = 30_000;
/**
 * Sessions change from outside this plugin (other TUIs, subagents, the web app).
 * A slow poll covers those; server events cover the common cases immediately.
 */
const REFRESH_MS = 60_000;

/**
 * Rows shown before paging. Kept small so the session view keeps its room;
 * the footer line says how many are hidden.
 */
const LIST_HEIGHT = 18;

// Mirrors OpenTUI's MouseButton values, so no runtime OpenTUI import is needed.
const LEFT = 0;
const RIGHT = 2;

/**
 * Acts on release only when the same button went down on the same element.
 * Without this, a click that starts as a scroll or drag ends up activating.
 */
function clickable(handlers: { left?: (event: MouseEvent) => void; right?: (event: MouseEvent) => void }) {
  let pressed: number | undefined;
  return {
    onMouseDown(event: MouseEvent) {
      pressed = event.button;
      event.preventDefault();
      event.stopPropagation();
    },
    onMouseUp(event: MouseEvent) {
      const button = pressed;
      pressed = undefined;
      event.preventDefault();
      event.stopPropagation();
      if (button !== event.button) return;
      if (button === LEFT) handlers.left?.(event);
      if (button === RIGHT) handlers.right?.(event);
    },
    onMouseDragEnd() {
      pressed = undefined;
    },
  };
}

function ago(time: number, now: number) {
  if (!time) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function useNow() {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
  onCleanup(() => clearInterval(timer));
  return now;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens and focuses a session without touching its agent.
 *
 * `tabs.focus` opens the tab when needed. Tabs can be disabled entirely, in
 * which case the router is the only way to switch, so both paths are covered.
 */
function openSession(context: Context, sessionID: string) {
  if (context.ui.tabs.focus(sessionID)) return;
  context.ui.router.navigate({ type: "session", sessionID });
}


/**
 * Owns the global session list: loading, refreshing, and the derived snapshot.
 *
 * Raw server data is held in signals and the grouped view is a memo, so status
 * updates re-render without refetching and without rebuilding projects by hand.
 */
function useSessions(
  context: Context,
  manual: () => ManualStatusMap,
  only: () => SessionStatus | null,
) {
  const [rows, setRows] = createSignal<readonly SessionRowData[]>([]);
  const [projects, setProjects] = createSignal<readonly ProjectData[]>([]);
  const [status, setStatus] = createSignal<Readonly<Record<string, boolean>>>({});
  const [loaded, setLoaded] = createSignal(false);
  const [complete, setComplete] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>();
  let loading = false;
  let disposed = false;

  const reload = async () => {
    if (loading || disposed) return;
    loading = true;
    try {
      const [found, projectList] = await Promise.all([
        fetchAllSessions(context.client),
        context.client.project.list().catch(() => []),
      ]);
      if (disposed) return;
      setRows(found.sessions);
      setProjects(projectList);
      setComplete(found.complete);
      setError(found.error);
    } catch (cause) {
      if (disposed) return;
      setError(message(cause));
    } finally {
      loading = false;
      if (!disposed) setLoaded(true);
    }
  };

  // Busy state is client-local and already kept current by the host, so it
  // costs nothing to read on every tick.
  const syncStatus = () => {
    const next: Record<string, boolean> = {};
    for (const tab of context.ui.tabs.list()) {
      if (tab.busy) next[tab.sessionID] = true;
    }
    setStatus(next);
  };

  const snapshot = createMemo(() =>
    buildSnapshot(rows(), projects(), {
      status: status(),
      complete: complete(),
      error: error(),
      manual: manual(),
      only: only(),
    }),
  );

  createEffect(() => {
    syncStatus();
    void reload();
  });

  const timer = setInterval(() => void reload(), REFRESH_MS);
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
  });

  // Server-side changes: a session created, renamed, deleted or moved.
  const stops = [
    context.data.on("session.created", () => void reload()),
    context.data.on("session.deleted", () => void reload()),
    context.data.on("session.renamed", () => void reload()),
    context.data.on("session.moved", () => void reload()),
    context.data.on("session.archived", () => void reload()),
    context.data.on("session.unarchived", () => void reload()),
    context.data.on("session.status", () => syncStatus()),
  ];
  onCleanup(() => stops.forEach((stop) => stop()));

  return { snapshot, loaded, reload };
}

function Header(props: {
  context: Context;
  snapshot: Snapshot | undefined;
  open: boolean;
  filter: SessionStatus | null;
  onToggle: () => void;
  onBrowse: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const [hoveredFind, setHoveredFind] = createSignal(false);
  const summary = () => {
    const snapshot = props.snapshot;
    if (!snapshot) return "loading";
    const projects = `${snapshot.projectCount} project${snapshot.projectCount === 1 ? "" : "s"}`;
    const sessions = `${snapshot.sessionCount} session${snapshot.sessionCount === 1 ? "" : "s"}`;
    const meta = metaFor(props.filter ?? undefined);
    const suffix = meta ? ` · ${meta.glyph} ${meta.label}` : "";
    return `${projects} · ${sessions}${suffix}${snapshot.complete ? "" : " · partial"}`;
  };

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        backgroundColor={hovered() ? theme.background.raised.high : undefined}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        {...clickable({ left: props.onToggle })}
      >
        <text fg={theme.text.base} flexShrink={0}>
          {props.open ? "▼" : "▶"}
        </text>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          <b>Projects</b>
          <span style={{ fg: theme.text.muted }}> /board</span>
        </text>
        <Show when={props.open}>
          <box
            flexShrink={0}
            backgroundColor={hoveredFind() ? theme.background.raised.high : undefined}
            onMouseOver={() => setHoveredFind(true)}
            onMouseOut={() => setHoveredFind(false)}
            // Stops the header's own toggle handler from also firing.
            {...clickable({ left: props.onBrowse })}
          >
            <text fg={theme.text.muted}>⌕</text>
          </box>
        </Show>
      </box>
      <Show when={props.open}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {summary()}
        </text>
      </Show>
    </box>
  );
}

function SessionRow(props: {
  context: Context;
  row: ProjectGroup["rows"][number];
  now: number;
  active: boolean;
  onSelect: () => void;
  onStatus: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const [hoveredStatus, setHoveredStatus] = createSignal(false);

  /**
   * The status glyph doubles as the status button. `running` keeps its own
   * marker, so a live agent is never mistaken for a user-set status.
   */
  const statusMeta = () => metaFor(props.row.status);
  const glyph = () => {
    const meta = statusMeta();
    if (meta) return { char: meta.glyph, fg: toneColor(props.context, meta.tone) };
    if (props.row.running) return { char: "●", fg: theme.text.feedback.info.base };
    if (props.active) return { char: "◆", fg: theme.text.base };
    return { char: "•", fg: theme.text.muted };
  };

  return (
    <box
      flexDirection="row"
      gap={1}
      // One column of padding, mirrored by the glyph box's own padding, so the
      // status target is 3 cells wide while the glyph stays aligned.
      paddingLeft={1}
      backgroundColor={hovered() ? theme.background.raised.high : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...clickable({ left: props.onSelect, right: props.onStatus })}
    >
      {/*
        The glyph is the status button, but one cell is a very small target, so
        it is padded out to a consistent 3-column gutter. Padding keeps the
        clickable area while `flexShrink={0}` stops it collapsing.
      */}
      <box
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={hoveredStatus() ? theme.background.raised.base : undefined}
        onMouseOver={() => setHoveredStatus(true)}
        onMouseOut={() => setHoveredStatus(false)}
        {...clickable({ left: props.onStatus })}
      >
        <text fg={glyph().fg}><span style={{ bold: props.row.status === "focus" || props.row.status === "urgent" }}>{glyph().char}</span></text>
      </box>
      <text
        fg={props.active ? theme.text.base : theme.text.muted}
        wrapMode="none"
        truncate
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
      >
        {/* Bold separates the current session from the rest; colour alone was
            too subtle against a list of already-muted titles. */}
        <span style={{ bold: props.active }}>{props.row.title}</span>
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        {ago(props.row.activity, props.now)}
      </text>
    </box>
  );
}

function GroupHeader(props: {
  context: Context;
  group: ProjectGroup;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const running = () => props.group.rows.some((row) => row.running);

  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={hovered() ? theme.background.raised.high : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...clickable({ left: props.onToggle })}
    >
      <text fg={theme.text.muted} flexShrink={0}>
        {props.collapsed ? "▶" : "▼"}
      </text>
      <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
        <b>{props.group.name}</b>
        <Show when={props.group.hint}>
          <span style={{ fg: theme.text.muted }}> {props.group.hint}</span>
        </Show>
        <Show when={props.collapsed}>
          <span style={{ fg: theme.text.muted }}> ({props.group.rows.length})</span>
        </Show>
      </text>
      <Show when={running() && props.collapsed}>
        <text fg={theme.text.feedback.info.base} flexShrink={0}>
          ●
        </text>
      </Show>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        {ago(props.group.activity, props.now)}
      </text>
    </box>
  );
}

function Sidebar(props: {
  context: Context;
  open: boolean;
  collapsed: Record<string, boolean>;
  filter: SessionStatus | null;
  onToggleOpen: () => void;
  onToggleGroup: (key: string) => void;
  onBrowse: () => void;
  onStatus: (row: ProjectGroup["rows"][number]) => void;
  data: ReturnType<typeof useSessions>;
}) {
  const context = props.context;
  const theme = context.theme;
  const now = useNow();
  const [offset, setOffset] = createSignal(0);

  /**
   * A flat, render-ready list of rows so one scroll offset can move over
   * project headers and sessions together. A nested scrollbox does not receive
   * wheel events from the host sidebar, so paging is done by hand here.
   */
  const rows = createMemo(() => {
    const snapshot = props.data.snapshot();
    type Line =
      | { kind: "group"; group: ProjectGroup }
      | { kind: "session"; group: ProjectGroup; row: ProjectGroup["rows"][number] };
    const lines: Line[] = [];
    for (const group of snapshot.groups) {
      lines.push({ kind: "group", group });
      if (props.collapsed[group.key] === true) continue;
      for (const row of group.rows) {
        lines.push({ kind: "session", group, row });
      }
    }
    return lines;
  });

  // Reset the viewport when the filter or the shape of the list changes,
  // otherwise a stale offset can point past the end.
  createEffect(() => {
    rows().length;
    setOffset(0);
  });

  const window = () => {
    const lines = rows();
    const max = Math.max(0, lines.length - LIST_HEIGHT);
    const start = Math.min(Math.max(0, offset()), max);
    return { lines: lines.slice(start, start + LIST_HEIGHT), start, max };
  };

  const scroll = (delta: number) => {
    const { max } = window();
    setOffset((current) => Math.min(Math.max(0, current + delta), max));
  };

  const current = () => context.ui.router.current();

  const isActive = (sessionID: string) => {
    if (context.ui.tabs.enabled()) {
      return context.ui.tabs.list().some((tab) => tab.sessionID === sessionID && tab.active);
    }
    const route = current();
    return route.type === "session" && context.data.session.root(route.sessionID) === sessionID;
  };

  const select = (sessionID: string) => openSession(context, sessionID);

  const snapshot = () => props.data.snapshot();

  return (
    <SidebarCard context={context}>
      <Header
        context={context}
        snapshot={snapshot()}
        open={props.open}
        filter={props.filter}
        onToggle={props.onToggleOpen}
        onBrowse={props.onBrowse}
      />
      <Show when={props.open}>
        <Show
          when={snapshot().groups.length}
          fallback={
            <text fg={theme.text.muted} wrapMode="none" truncate paddingLeft={1}>
              {snapshot().error
                ? "Couldn't load sessions"
                : props.data.loaded()
                  ? "No sessions"
                  : "Loading sessions…"}
            </text>
          }
        >
          <box
            flexDirection="column"
            // Wheel anywhere over the list pages it; the sidebar itself does not scroll.
            onMouseScroll={(event: MouseEvent) => {
              scroll(event.scroll?.direction === "up" ? -3 : 3);
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <For each={window().lines}>
              {(line) => {
                if (line.kind === "group") {
                  return (
                    <box flexDirection="column" paddingTop={1}>
                      <GroupHeader
                        context={context}
                        group={line.group}
                        now={now()}
                        collapsed={props.collapsed[line.group.key] === true}
                        onToggle={() => props.onToggleGroup(line.group.key)}
                      />
                    </box>
                  );
                }
                return (
                  <SessionRow
                    context={context}
                    row={line.row}
                    now={now()}
                    active={isActive(line.row.id)}
                    onSelect={() => select(line.row.id)}
                    onStatus={() => props.onStatus(line.row)}
                  />
                );
              }}
            </For>
            <Show when={window().max > 0}>
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {`${window().start + 1}–${Math.min(
                  window().start + LIST_HEIGHT,
                  rows().length,
                )} of ${rows().length} · scroll for more`}
              </text>
            </Show>
          </box>
        </Show>
      </Show>
    </SidebarCard>
  );
}

export default Plugin.define({
  id: "opencode.project-sessions",
  setup(context) {
    const [settings, update] = context.storage.store<Settings>("view", {
      initial: { open: true, collapsed: {}, filter: null },
    });

    /**
     * Statuses live in their own durable store, keyed by immutable session ID.
     * `storage.store` is persisted to disk and live-synced across running TUI
     * instances, so a second OpenCode window sees a change without polling.
     */
    const [statuses, setStatuses] = context.storage.store<StatusSettings>("status", {
      initial: { byID: {} },
    });

    const manual = () => statuses.byID as ManualStatusMap;

    const filter = () => (isStatus(settings.filter) ? settings.filter : null);

    // Keep an unfiltered source so a filtered-out session can always be restored.
    const source = useSessions(context, manual, () => null);
    const filters = (): BoardFilters => settings.filters ?? (filter()
      ? { date: "", statuses: [filter()!] } : EMPTY_FILTERS);
    const archive = (): Archive => settings.archive ?? { projects: [], sessions: [] };
    const [boardQuery, setBoardQuery] = createSignal("");
    const data = { ...source, snapshot: createMemo(() => projectView(source.snapshot(), filters(), archive(), boardQuery(), settings.sort)) };

    // Read-only bridge for sibling TUI plugins; never changes session titles or server state.
    const bridge = { status: (id: string) => statusOf(manual(), id) };
    const shared = globalThis as typeof globalThis & { __opencodeProjectSessions?: typeof bridge };
    shared.__opencodeProjectSessions = bridge;
    onCleanup(() => { if (shared.__opencodeProjectSessions === bridge) delete shared.__opencodeProjectSessions; });

    const toggleOpen = () =>
      void update((draft) => {
        draft.open = !draft.open;
      });

    const toggleGroup = (key: string) =>
      void update((draft) => {
        draft.collapsed ??= {};
        draft.collapsed[key] = !draft.collapsed[key];
      });

    /**
     * Writes or clears one status.
     *
     * Only this map is touched: the session's title, its transcript, and any
     * running agent are left exactly as they are.
     */
    const setStatus = async (sessionID: string, status: SessionStatus | null) => {
      await setStatuses((draft) => {
        draft.byID ??= {};
        if (status) draft.byID[sessionID] = status;
        else delete draft.byID[sessionID];
      });
    };

    const pickStatus = async (target: { readonly id: string; readonly title: string }) => {
      const current = statusOf(manual(), target.id);
      const picked = await context.ui.dialog.select<SessionStatus | "clear">({
        title: `Status — ${target.title}`,
        placeholder: "Pick a status",
        current: current ?? undefined,
        options: [
          ...STATUSES.map((status) => ({
            title: `${STATUS_META[status].glyph}  ${STATUS_META[status].label}`,
            value: status as SessionStatus | "clear",
          })),
          { title: "Clear status", value: "clear" as const },
        ],
      });
      if (!picked) return;
      await setStatus(target.id, picked === "clear" ? null : picked);
    };

    /** Archive is plugin-local and reversible; it never deletes or stops a session. */
    const manageArchive = async (direct?: "archive" | "restore") => {
      const action = direct ?? await context.ui.dialog.select({ title: "Projects archive", options: [
        { title: "Archive a project", value: "project", description: "Hide the project and all its sessions" },
        { title: "Archive a session", value: "session", description: "Hide just one session" },
        { title: "Restore archived items", value: "restore", description: "Bring projects and sessions back" },
      ] });
      if (!action) return;
      const groups = source.snapshot().groups;
      type Target = ArchiveTarget;
      const projects = groups.map((group) => ({ title: group.name, description: group.directory, activity: group.activity,
        value: { kind: "project", id: group.key } as Target }));
      const sessions = groups.flatMap((group) => group.rows.map((row) => ({ title: row.title,
        description: group.name, activity: row.activity, value: { kind: "session", id: row.id } as Target })));
      const archived = (target: Target) => (target.kind === "project" ? archive().projects : archive().sessions).includes(target.id);
      const candidates = action === "project" ? projects.filter((item) => !archived(item.value))
        : action === "session" ? sessions.filter((item) => !archived(item.value))
        : action === "archive" ? [...projects, ...sessions].filter((item) => !archived(item.value))
        : [...projects.filter((item) => archived(item.value)), ...sessions.filter((item) => archived(item.value)),
          ...archive().projects.filter((id) => !projects.some((item) => item.value.id === id)).map((id) => ({ title: id, description: "Project", value: { kind: "project", id } as Target })),
          ...archive().sessions.filter((id) => !sessions.some((item) => item.value.id === id)).map((id) => ({ title: id, description: "Session", value: { kind: "session", id } as Target }))];
      const picked = await new Promise<readonly Target[] | undefined>((resolve) => {
        context.ui.dialog.set({ size: "large", centered: true });
        context.ui.dialog.show(() => <ArchiveDialog context={context} options={candidates} restoring={action === "restore"}
          onConfirm={(targets) => { resolve(targets); context.ui.dialog.clear(); }}
          onCancel={() => context.ui.dialog.clear()} />, () => resolve(undefined));
      });
      if (!picked?.length) return;
      await update((draft) => {
        const value = draft.archive ?? { projects: [], sessions: [] };
        draft.archive = updateArchive(value, picked, action === "restore");
      });
    };
    const openFilters = (onClose?: () => void, value?: BoardFilters) => {
      context.ui.dialog.set({ size: "large", centered: true });
      let navigating = false;
      context.ui.dialog.show(() => <BoardFilterDialog context={context} value={value ?? filters()}
        archivedCount={archive().projects.length + archive().sessions.length}
        onArchive={(draft) => {
          navigating = true;
          void manageArchive().finally(() => openFilters(onClose, draft));
        }}
        onApply={(next) => { void update((draft) => { draft.filters = next; draft.filter = null; }); context.ui.dialog.clear(); }}
        onCancel={() => context.ui.dialog.clear()} />,
        () => { if (!navigating) onClose?.(); });
    };

    /**
     * Full keyboard-driven jump list over every session.
     *
     * An inline text field is not available in a sidebar slot (OpenTUI has no
     * input renderable), so search lives in the native picker instead: it
     * filters as you type and supports arrow keys and enter.
     */
    const browse = async () => {
      const entries = flatten(data.snapshot());
      if (entries.length === 0) {
        context.ui.toast.show({
          title: "Projects & sessions",
          message: data.loaded() ? "No sessions to show" : "Still loading sessions",
          variant: "info",
          duration: 1600,
        });
        return;
      }
      const chosen = await context.ui.dialog.select<FlatSession>({
        title: "All sessions",
        placeholder: "Search title, project, or path",
        options: entries.map((entry) => ({
          title: entry.title,
          value: entry,
          description: entry.project,
          footer: entry.directory,
        })),
        search: (query, options) => {
          const needle = query.trim().toLowerCase();
          if (!needle) return options;
          return options.filter((option) => {
            const entry = option.value;
            return [entry.title, entry.project, entry.directory].some((field) =>
              field.toLowerCase().includes(needle),
            );
          });
        },
      });
      if (chosen) openSession(context, chosen.id);
    };

    /**
     * Keyboard-only path: choose the session first, then its status.
     *
     * Reuses the same picker shape as `browse` so search works here too.
     */
    const pickStatusForAny = async () => {
      const entries = flatten(data.snapshot());
      if (entries.length === 0) {
        context.ui.toast.show({
          title: "Session status",
          message: data.loaded() ? "No sessions to show" : "Still loading sessions",
          variant: "info",
          duration: 1600,
        });
        return;
      }
      const chosen = await context.ui.dialog.select<FlatSession>({
        title: "Set session status",
        placeholder: "Search title, project, or path",
        options: entries.map((entry) => {
          const meta = metaFor(entry.status);
          return {
            title: meta ? `${meta.glyph}  ${entry.title}` : entry.title,
            value: entry,
            description: entry.project,
            footer: meta ? meta.label : "no status",
          };
        }),
        search: (query, options) => {
          const needle = query.trim().toLowerCase();
          if (!needle) return options;
          return options.filter((option) => {
            const entry = option.value;
            return [entry.title, entry.project, entry.directory].some((field) =>
              field.toLowerCase().includes(needle),
            );
          });
        },
      });
      if (!chosen) return;
      await pickStatus(chosen);
    };

    // Warm the project cache so the first render already has names.
    void context.data.project.sync();

    // A deleted session must not leave an orphan status behind. Statuses for
    // sessions outside this server are left alone; the event never names them.
    const stopDeleted = context.data.on("session.deleted", (event) => {
      const sessionID = (event as { data?: { sessionID?: string } }).data?.sessionID;
      if (!sessionID || statusOf(manual(), sessionID) === undefined) return;
      void setStatus(sessionID, null);
    });
    onCleanup(stopDeleted);

    /**
     * Board state: the live search text. Persisting it would surprise the user
     * by reopening a filtered board, so it is deliberately in-memory only.
     */

    const openBoard = () => {
      if (!context.ui.panel.open("board", { presentation: "fullscreen" })) {
        context.ui.toast.show({
          title: "Sessions board",
          message: "This TUI does not expose the session panel.",
          variant: "error",
          duration: 2000,
        });
      }
    };

    const searchBoard = async () => {
      const value = await context.ui.dialog.prompt({
        title: "Filter sessions",
        placeholder: "Title, project, or path",
        value: boardQuery(),
      });
      // Cancelling leaves the current filter alone rather than clearing it.
      if (value === undefined) return;
      setBoardQuery(value);
    };

    /** Board cards come from the same snapshot the sidebar renders. */
    const boardCards = () => projectView(source.snapshot(), EMPTY_FILTERS, archive()).groups.flatMap((group) =>
      group.rows.map((entry) => ({
        id: entry.id,
        title: entry.title,
        projectKey: group.key,
        project: group.hint ? `${group.name} (${group.hint})` : group.name,
        directory: group.directory,
        activity: entry.activity,
        ...(entry.status ? { status: entry.status } : {}),
      })),
    );

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        ...(["archive", "restore"] as const).map((action) => ({
          id: `project-sessions.${action}`,
          title: action === "archive" ? "Archive projects and sessions" : "Restore archived projects and sessions",
          group: "Sessions", palette: true as const,
          slash: { name: action === "archive" ? "archive" : "restore-archive" },
          run: () => void manageArchive(action),
        })),
        ...(["projects", "todo"] as const).flatMap((area) => ([true, false] as const).map((visible) => ({
          id: `project-sessions.sidebar.${area}.${visible ? "open" : "close"}`,
          title: `Sidebar: ${visible ? "show" : "hide"} ${area === "todo" ? "Todo" : "Projects"}`,
          group: "Sidebar", palette: true as const,
          slash: { name: `sidebar-${area}-${visible ? "open" : "close"}` },
          run: () => void update((draft) => {
            if (area === "projects") { draft.hidden = !visible; if (visible) draft.open = true; }
            else { draft.todoHidden = !visible; if (visible) draft.todoOpen = true; }
          }),
        }))),
        ...(["status", "activity"] as const).map((sort) => ({
          id: `project-sessions.sort.${sort}`, title: `Sidebar: sort Projects by ${sort}`,
          group: "Sidebar", palette: true as const, slash: { name: `sidebar-sort-by-${sort}` },
          run: () => void update((draft) => { draft.sort = sort; }),
        })),
        {
          id: "project-sessions.toggle",
          title: settings.open ? "Hide project sessions" : "Show project sessions",
          group: "Sessions",
          palette: true,
          run: toggleOpen,
        },
        {
          id: "project-sessions.board",
          title: "Open sessions board",
          description: "Full-screen board: drag cards between statuses",
          group: "Sessions",
          palette: true,
          slash: { name: "board" },
          run: () => openBoard(),
        },
        {
          id: "project-sessions.board.search",
          title: "Board: filter sessions",
          group: "Sessions",
          run: () => void searchBoard(),
        },
        {
          id: "project-sessions.browse",
          title: "Browse all sessions",
          description: "Search every session across all projects",
          group: "Sessions",
          palette: true,
          slash: { name: "sessions" },
          run: () => void browse(),
        },
        {
          id: "project-sessions.status",
          title: "Set session status",
          description: "Tag any session as started, in progress, stopped, done, or urgent",
          group: "Sessions",
          palette: true,
          slash: { name: "session-status" },
          run: () => void pickStatusForAny(),
        },
        {
          id: "project-sessions.filter",
          title: "Projects: filters and archive",
          description: "Shared date and status filters for Projects and /board",
          group: "Sessions",
          palette: true,
          slash: { name: "sidebar-projects-filter" },
          run: () => openFilters(),
        },
        {
          id: "project-sessions.refresh",
          title: "Refresh project sessions",
          group: "Sessions",
          palette: true,
          run: () => void data.reload(),
        },
      ],
    }));

    context.ui.slot({
      prepend: "sidebar.content",
      render: () => (
        <Show when={!settings.hidden}><Sidebar
          context={context}
          open={settings.open}
          collapsed={settings.collapsed ?? {}}
          filter={filter()}
          onToggleOpen={toggleOpen}
          onToggleGroup={toggleGroup}
          onBrowse={() => openFilters()}
          onStatus={(row) => void pickStatus(row)}
          data={data}
        /></Show>
      ),
    });

    context.ui.slot({
      append: "sidebar.content",
      render: (input) => <Show when={!settings.todoHidden}><SidebarTodo
        context={context}
        sessionID={input.sessionID}
        open={settings.todoOpen ?? true}
        onToggle={() => void update((draft) => { draft.todoOpen = !(draft.todoOpen ?? true); })}
      /></Show>,
    });

    context.ui.slot({
      prepend: "session.panel",
      render: (input) => {
        // Only claim the panel while the board is the selected content; the
        // same slot hosts every session panel in this TUI.
        if (input.name !== "board") return <></>;
        // A freshly opened panel does not own the keyboard yet, so the board's
        // keymap layer would be registered but unreachable.
        if (!input.focused) queueMicrotask(() => input.focus());
        return (
          <Board
            context={context}
            cards={boardCards()}
            query={boardQuery()}
            filters={filters()}
            onFilters={(onClose) => openFilters(onClose)}
            onSearch={() => void searchBoard()}
            onSetStatus={(sessionID, status) => void setStatus(sessionID, status)}
            onOpen={(sessionID) => openSession(context, sessionID)}
            onClose={() => input.close()}
          />
        );
      },
    });
  },
});
