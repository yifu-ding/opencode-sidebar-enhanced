/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  buildBoard,
  buildProjectColumns,
  ALL_BOARD_STATUSES,
  parseBoardDate,
  columnAt,
  columnBoxes,
  columnOf,
  statusForDrop,
  totalCards,
  visibleColumnKeys,
  type BoardCard,
  type BoardMode,
  type BoardFilters,
  type ViewColumn,
  type ColumnKey,
} from "./board.ts";
import { metaFor, type SessionStatus } from "./status.ts";
import { toneColor } from "./theme.ts";

/**
 * Full-screen kanban board over every session.
 *
 * Columns are the statuses from `status.ts`; cards are sessions. Dragging a card
 * to another column rewrites that session's status, using the same store the
 * sidebar reads, so the two views never disagree.
 */

/** Gutter between columns, in cells. Also used to hit-test drops. */
const GAP = 2;
/** Left margin of the board, in cells. */
const MARGIN = 1;

type Drag = {
  readonly id: string;
  readonly from: ColumnKey;
};

function Card(props: {
  context: Context;
  card: BoardCard;
  dragging: boolean;
  selected: boolean;
  onPickUp: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const meta = () => metaFor(props.card.status);

  return (
    <box
      id={`board-card-${props.card.id}`}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={0}
      // Never shrink a card: when a column overflows, a compressed card loses
      // its bottom border and the project line is painted over it.
      flexShrink={0}
      backgroundColor={
        hovered() || props.dragging || props.selected
          ? theme.background.raised.high
          : undefined
      }
      border={["left"]}
      borderColor={
        props.dragging
          ? toneColor(props.context, meta()?.tone ?? "info")
          : props.selected
            ? theme.text.base
            : theme.background.raised.base
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event: MouseEvent) => {
        if (event.button !== 0) return;
        props.onPickUp();
        event.preventDefault();
        event.stopPropagation();
      }}
      // The release is handled once, by the board, so a click and a drop share
      // a single code path and cannot both fire.
    >
      <text fg={theme.text.base} wrapMode="word" flexShrink={0}>
        {props.card.title}
      </text>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {props.card.project || "no project"}
      </text>
    </box>
  );
}

function Column(props: {
  context: Context;
  column: ViewColumn;
  cards: readonly BoardCard[];
  drag: Drag | undefined;
  cursorIndex: number | undefined;
  onPickUp: (card: BoardCard, from: string) => void;
}) {
  const theme = props.context.theme;
  const meta = () => metaFor(props.column.status);
  const accent = () => (meta() ? toneColor(props.context, meta()!.tone) : theme.text.muted);
  const key = props.column.key;
  let list: ScrollBoxRenderable | undefined;
  createEffect(() => {
    const index = props.cursorIndex;
    const card = index === undefined ? undefined : props.cards[index];
    if (card) queueMicrotask(() => {
      if (list && !list.isDestroyed) list.scrollChildIntoView(`board-card-${card.id}`);
    });
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
      minHeight={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      borderStyle="rounded"
      borderColor={theme.text.muted}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={accent()} flexShrink={0}>
          <span style={{ bold: props.column.status === "focus" || props.column.status === "urgent" }}>{props.column.glyph}</span>
        </text>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          <b>{props.column.label}</b>
        </text>
        <text fg={theme.text.muted} flexShrink={0}>
          {props.cards.length}
        </text>
      </box>
      <Show
        when={props.cards.length > 0}
        fallback={
          <text fg={theme.text.muted} wrapMode="none" truncate>
            empty
          </text>
        }
      >
        <scrollbox
          ref={(element) => { list = element; }}
          flexGrow={1}
          minHeight={0}
          scrollX={false}
          scrollY
          contentOptions={{ flexDirection: "column", paddingTop: 1 }}
        >
          <For each={props.cards}>
            {(card, index) => (
              <Card
                context={props.context}
                card={card}
                dragging={props.drag?.id === card.id}
                selected={props.cursorIndex === index()}
                onPickUp={() => props.onPickUp(card, key)}
              />
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}

export function Board(props: {
  context: Context;
  cards: readonly BoardCard[];
  query: string;
  filters: BoardFilters;
  onFilters: (onClose: () => void) => void;
  onSearch: () => void;
  onSetStatus: (sessionID: string, status: SessionStatus | null) => void;
  onOpen: (sessionID: string) => void;
  onClose: () => void;
}) {
  const context = props.context;
  const theme = context.theme;
  const [drag, setDrag] = createSignal<Drag | undefined>();
  const [mode, setMode] = createSignal<BoardMode>("status");
  const filters = () => props.filters;
  let root: BoxRenderable | undefined;
  /** Card under the keyboard cursor, so the board is usable without a mouse. */
  const [cursor, setCursor] = createSignal<{ key: string; index: number } | undefined>();


  const options = createMemo(() => ({
    query: props.query,
    since: parseBoardDate(filters().date),
    statuses: filters().statuses,
  }));
  const board = createMemo(() => buildBoard(props.cards, options()));

  const columns = createMemo<readonly ViewColumn[]>(() => mode() === "project"
    ? buildProjectColumns(props.cards, options())
    : visibleColumnKeys(board(), !!drag()).map((key) => {
      const column = board().columns.find((entry) => entry.status === key);
      return { key, label: column?.label ?? "Untriaged", glyph: column?.glyph ?? "·", status: column?.status, cards: columnOf(board(), key) };
    }));
  const keys = createMemo(() => columns().map((column) => column.key));
  const cardsIn = (key: string) => columns().find((column) => column.key === key)?.cards ?? [];
  const switchMode = () => {
    setDrag(undefined);
    setCursor(undefined);
    setMode((current) => current === "status" ? "project" : "status");
  };
  const filterCount = () => Number(!!filters().date) + Number(filters().statuses.length !== ALL_BOARD_STATUSES.length);
  const openFilters = () => {
    setDrag(undefined);
    setCursor(undefined);
    props.onFilters(() => queueMicrotask(() => { if (root && !root.isDestroyed) root.focus(); }));
  };

  /**
   * Column geometry, shared by layout and hit-testing so the drawn columns and
   * the drop targets cannot drift apart.
   */
  const boxes = createMemo(() =>
    columnBoxes(keys(), MARGIN, context.renderer.width - MARGIN, GAP),
  );


  /**
   * Resolves the column under a pointer x, reusing the geometry the layout
   * actually produces. Shared by drops so the hit box and the drawing cannot
   * drift apart.
   */
  const columnUnder = (x: number) => columnAt(boxes(), x);


  /**
   * Keyboard model, mirroring the mouse: arrow keys walk the grid, `space`
   * picks a card up and drops it, so the board never requires a pointer.
   */
  const cursorCard = () => {
    const at = cursor();
    if (!at) return undefined;
    return cardsIn(at.key)[at.index];
  };

  const step = (dx: number, dy: number) => {
    const keysNow = keys();
    if (!keysNow.length) return;
    const at = cursor() ?? { key: keysNow[0]!, index: 0 };
    let keyIndex = keysNow.indexOf(at.key);
    // A drop can empty the cursor's column, so clamp it before moving.
    keyIndex = keyIndex < 0 ? 0 : keyIndex;

    if (dx !== 0) {
      const nextKey = keysNow[Math.min(keysNow.length - 1, Math.max(0, keyIndex + dx))]!;
      const cards = cardsIn(nextKey);
      return setCursor({ key: nextKey, index: Math.min(at.index, Math.max(0, cards.length - 1)) });
    }

    const cards = cardsIn(at.key);
    if (dy !== 0 && cards.length > 0) {
      const index = Math.min(cards.length - 1, Math.max(0, at.index + dy));
      setCursor({ key: at.key, index });
    }
  };

  const togglePick = () => {
    if (mode() !== "status") return;
    const current = drag();
    if (!current) {
      // First space selects the leading card so the keyboard works from cold.
      const key = keys()[0];
      if (!key) return;
      const previous = cursor();
      const at = previous && keys().includes(previous.key) ? previous : { key, index: 0 };
      setCursor(at);
      const card = cardsIn(at.key)[at.index];
      if (card) setDrag({ id: card.id, from: at.key as ColumnKey });
      return;
    }
    // Dropping onto the card's own column just clears the pick.
    if (cursor()?.key !== current.from) {
      props.onSetStatus(current.id, statusForDrop((cursor()?.key ?? current.from) as ColumnKey));
    }
    setDrag(undefined);
  };

  const release = (x: number) => {
    const current = drag();
    // Resolve against the visible drop targets before hiding empty columns.
    const target = columnUnder(x);
    setDrag(undefined);
    if (!current) return;
    if (!target || target === current.from) {
      // A release on the card's own column is a click: open the session.
      props.onOpen(current.id);
      return;
    }
    props.onSetStatus(current.id, statusForDrop(target as ColumnKey));
  };

  /**
   * Keys arrive on the rendered element rather than through a keymap layer:
   * the board owns its input mode, and a layer registered from inside a panel
   * slot was never reached.
   */
  const onKeyDown = (event: KeyEvent) => {
    switch (event.name) {
      case "f":
        return openFilters();
      case "tab":
      case "[":
      case "]":
        event.preventDefault();
        event.stopPropagation();
        return switchMode();
      case "escape":
        return props.onClose();
      case "left":
      case "h":
        return step(-1, 0);
      case "right":
      case "l":
        return step(1, 0);
      case "up":
      case "k":
        return step(0, -1);
      case "down":
      case "j":
        return step(0, 1);
      case "space":
        return togglePick();
      case "return":
      case "enter": {
        const card = cursorCard();
        if (card) props.onOpen(card.id);
        return;
      }
      case "slash":
        return props.onSearch();
      default:
        return;
    }
  };

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      focusable
      backgroundColor={theme.background.base}
      ref={(element) => { root = element; queueMicrotask(() => element.focus()); }}
      onKeyDown={onKeyDown}
    >
      {/* Title row */}
      <box flexDirection="row" gap={1} paddingLeft={MARGIN} flexShrink={0}>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          <b>Sessions</b>
          <span style={{ fg: theme.text.muted }}>
            {`  ·  ${totalCards(board())} shown`}
          </span>
        </text>
        <box paddingLeft={1} paddingRight={1} onMouseDown={(event) => {
          switchMode();
          event.preventDefault();
          event.stopPropagation();
        }}>
          <text fg={theme.text.base}><b>{mode() === "status" ? "Mode: Status" : "Mode: Project"}</b></text>
        </box>
        <box paddingLeft={1} paddingRight={1} onMouseDown={(event) => {
          event.preventDefault(); event.stopPropagation();
        }} onMouseUp={(event) => {
          event.preventDefault(); event.stopPropagation();
          if (event.button === 0) openFilters();
        }}>
          <text fg={theme.text.base}><b>{filterCount() ? `Filters (${filterCount()})` : "Filters"}</b></text>
        </box>
        <box
          flexShrink={0}
          borderStyle="rounded"
          borderColor={theme.text.muted}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(event: MouseEvent) => {
            props.onClose();
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <text fg={theme.text.muted}>close</text>
        </box>
      </box>

      {/* Search row */}
      <box flexDirection="row" gap={1} paddingLeft={MARGIN} paddingTop={1} flexShrink={0}>
        <box
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          borderStyle="rounded"
          borderColor={theme.text.muted}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(event: MouseEvent) => {
            props.onSearch();
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Show
            when={props.query}
            fallback={<text fg={theme.text.muted}>Search titles, projects, or paths…</text>}
          >
            <text fg={theme.text.base} wrapMode="none" truncate>
              {props.query}
            </text>
          </Show>
        </box>
      </box>

      <text fg={theme.text.muted} paddingLeft={MARGIN} paddingTop={1} flexShrink={0}>
        {mode() === "project"
          ? "Tab / [ ]: switch mode · f: filters · arrows: navigate · enter or click: open session"
          : drag()
          ? "release over a column, or space, to change status"
          : "Tab / [ ]: switch mode · f: filters · drag a card, or space then arrows, to change status"}
      </text>

      {/* Columns */}
      <box
        flexDirection="row"
        gap={GAP}
        paddingLeft={MARGIN}
        paddingTop={1}
        flexGrow={1}
        minHeight={0}
        onMouseUp={(event: MouseEvent) => {
          if (!drag() || event.button !== 0) return;
          release(event.x);
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Show when={columns().length === 0}>
          <text fg={theme.text.muted}>No sessions match. Press f to adjust filters.</text>
        </Show>
        <For each={keys()}>
          {(key) => {
            return (
              <Column
                context={context}
                column={columns().find((column) => column.key === key)!}
                cards={cardsIn(key)}
                drag={drag()}
                cursorIndex={cursor()?.key === key ? cursor()!.index : undefined}
                onPickUp={(card, from) => {
                  setCursor({ key: from, index: cardsIn(from).indexOf(card) });
                  if (mode() === "project") props.onOpen(card.id);
                  else setDrag({ id: card.id, from: from as ColumnKey });
                }}
              />
            );
          }}
        </For>
      </box>
    </box>
  );
}
