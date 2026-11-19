/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { createEffect, createSignal, For } from "solid-js";
import { ALL_BOARD_STATUSES, parseBoardDate, type BoardFilters, type ColumnKey } from "./board.ts";
import { calendarWeeks, dateKey, moveDate, moveMonth } from "./calendar.ts";
import { metaFor } from "./status.ts";
import { toneColor } from "./theme.ts";

/** Draft-only controls. Clicking the calendar never applies or closes the dialog. */
export function BoardFilterDialog(props: {
  context: Context;
  value: BoardFilters;
  archivedCount: number;
  onArchive: (draft: BoardFilters) => void;
  onApply: (filters: BoardFilters) => void;
  onCancel: () => void;
}) {
  const theme = props.context.theme;
  const [date, setDate] = createSignal(props.value.date);
  const [day, setDay] = createSignal(new Date(parseBoardDate(props.value.date) ?? Date.now()));
  const [selected, setSelected] = createSignal<readonly ColumnKey[]>([...props.value.statuses]);
  const [focus, setFocus] = createSignal(0);
  let root: BoxRenderable | undefined;
  // Calendar is one keyboard target: arrows move by day/week, PgUp/PgDn by month.
  const previous = 1, next = 2, today = 3, clear = 4, statusStart = 5;
  const all = statusStart + ALL_BOARD_STATUSES.length, none = all + 1, archive = all + 2;
  const reset = all + 3, cancel = all + 4, apply = all + 5;
  const draft = (): BoardFilters => ({ date: date(), statuses: [...selected()] });
  const background = (index: number) => focus() === index ? theme.background.action.primary.focused : undefined;
  const foreground = (index: number) => focus() === index ? theme.text.action.primary.focused : theme.text.base;
  const toggle = (key: ColumnKey) => setSelected((current) => current.includes(key)
    ? current.filter((value) => value !== key)
    : ALL_BOARD_STATUSES.filter((value) => value === key || current.includes(value)));
  const activate = (index: number) => {
    setFocus(index);
    if (index === 0) setDate(dateKey(day()));
    else if (index === previous) setDay((value) => moveMonth(value, -1));
    else if (index === next) setDay((value) => moveMonth(value, 1));
    else if (index === today) { const now = new Date(); setDay(now); setDate(dateKey(now)); }
    else if (index === clear) setDate("");
    else if (index >= statusStart && index < all) toggle(ALL_BOARD_STATUSES[index - statusStart]!);
    else if (index === all) setSelected([...ALL_BOARD_STATUSES]);
    else if (index === none) setSelected([]);
    else if (index === archive) props.onArchive(draft());
    else if (index === reset) { setDate(""); setSelected([...ALL_BOARD_STATUSES]); }
    else if (index === cancel) props.onCancel();
    else if (index === apply) props.onApply(draft());
  };
  createEffect(() => {
    focus();
    queueMicrotask(() => { if (root && !root.isDestroyed) root.focus(); });
  });
  const onKeyDown = (event: KeyEvent) => {
    if (event.name === "escape") props.onCancel();
    else if (event.name === "tab") setFocus((current) => (current + (event.shift ? apply : 1)) % (apply + 1));
    else if (event.ctrl && (event.name === "return" || event.name === "enter")) props.onApply(draft());
    else if (focus() === 0 && ["left", "right", "up", "down"].includes(event.name)) {
      setDay((value) => moveDate(value, ({ left: -1, right: 1, up: -7, down: 7 } as Record<string, number>)[event.name]!));
    } else if (event.name === "pageup" || event.name === "pagedown") { setFocus(0); setDay((value) => moveMonth(value, event.name === "pageup" ? -1 : 1)); }
    else if (event.name === "down") setFocus((current) => (current + 1) % (apply + 1));
    else if (event.name === "up") setFocus((current) => (current + apply) % (apply + 1));
    else if (["return", "enter", "space"].includes(event.name)) activate(focus());
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  const button = (label: string, index: number) => {
    let pressed = false;
    return <box paddingX={1} backgroundColor={background(index)} onMouseDown={(event) => {
      pressed = event.button === 0; event.preventDefault(); event.stopPropagation();
    }} onMouseUp={(event) => {
      event.preventDefault(); event.stopPropagation();
      if (pressed && event.button === 0) activate(index);
      pressed = false;
    }} onMouseDragEnd={() => { pressed = false; }}><text fg={foreground(index)}><span style={{ bold: focus() === index }}>{focus() === index ? "› " : "  "}{label}</span></text></box>;
  };
  return (
    <box paddingX={2} paddingY={1} flexDirection="column" focusable ref={(element) => { root = element; }} onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
      <text fg={theme.text.base}><b>Projects filters</b></text>
      <text fg={theme.text.muted} marginBottom={1}>Shared by Projects sidebar and /board · Tabs are unchanged.</text>
      <text fg={theme.text.base}><b>Date · active on or after</b></text>
      <box paddingLeft={2} flexDirection="column">
        <box flexDirection="row" gap={1}>
          {button("‹", previous)}
          <text fg={theme.text.base} width={20}><b>{day().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b></text>
          {button("›", next)}{button("Today", today)}{button("Any date", clear)}
        </box>
        <box flexDirection="row"><For each={["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]}>{(label) => <text width={4} fg={theme.text.muted}>{` ${label} `}</text>}</For></box>
        <For each={calendarWeeks(day())}>{(week) => <box flexDirection="row">
          <For each={week}>{(value) => <box width={4}
            backgroundColor={focus() === 0 && dateKey(day()) === dateKey(value) ? theme.background.action.primary.focused : date() === dateKey(value) ? theme.background.raised.high : undefined}
            onMouseDown={(event) => { setFocus(0); setDay(value); setDate(dateKey(value)); event.preventDefault(); event.stopPropagation(); }}>
            <text fg={focus() === 0 && dateKey(day()) === dateKey(value) ? theme.text.action.primary.focused : value.getMonth() === day().getMonth() ? theme.text.base : theme.text.muted}>
              <span style={{ bold: date() === dateKey(value) || dateKey(day()) === dateKey(value) }}>{focus() === 0 && dateKey(day()) === dateKey(value) ? `[${String(value.getDate()).padStart(2)}]` : `${date() === dateKey(value) ? "•" : " "}${String(value.getDate()).padStart(2)} `}</span>
            </text>
          </box>}</For>
        </box>}</For>
        <text fg={theme.text.muted}>{date() ? `From ${date()} (local time)` : "Any date"} · latest activity, not creation</text>
      </box>
      <text fg={theme.text.base} marginTop={1}><b>Status · select one or more</b></text>
      <box paddingLeft={2} flexDirection="column">
        <For each={ALL_BOARD_STATUSES}>{(key, index) => <box flexDirection="row" gap={1} backgroundColor={background(index() + statusStart)} onMouseDown={(event) => {
          activate(index() + statusStart); event.preventDefault(); event.stopPropagation();
        }}>
          <text fg={foreground(index() + statusStart)}>{focus() === index() + statusStart ? "›" : " "} {selected().includes(key) ? "[x]" : "[ ]"}</text>
          <text fg={foreground(index() + statusStart)}>
            <span style={{ fg: focus() === index() + statusStart ? foreground(index() + statusStart) : key === "untriaged" ? theme.text.muted : toneColor(props.context, metaFor(key)!.tone), bold: key === "focus" || key === "urgent" }}>{key === "untriaged" ? "·" : metaFor(key)!.glyph}</span>
            <span style={{ bold: focus() === index() + statusStart }}> {key === "untriaged" ? "Untriaged" : metaFor(key)!.label}</span>
          </text>
        </box>}</For>
        <box flexDirection="row" gap={1}>{button("Select all", all)}{button("Select none", none)}<text fg={theme.text.muted}>{selected().length} selected</text></box>
      </box>
      <text fg={theme.text.base} marginTop={1}><b>Archive</b></text>
      <box paddingLeft={2} flexDirection="column">
        <box flexDirection="row">{button(`Manage archive (${props.archivedCount})`, archive)}</box>
        <text fg={theme.text.muted}>Hide projects or sessions here and on /board. Restore anytime; nothing is deleted.</text>
      </box>
      <box flexDirection="row" gap={1} marginTop={1}>{button("Reset filters", reset)}{button("Cancel", cancel)}{button("Apply", apply)}</box>
      <text fg={theme.text.muted} marginTop={1}>Tab: next control · Calendar: arrows / PgUp / PgDn · Space: select · Ctrl+Enter: apply · Esc: cancel</text>
    </box>
  );
}
