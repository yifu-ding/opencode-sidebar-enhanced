/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import type { BoxRenderable, InputRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For } from "solid-js";

import type { ArchiveTarget } from "./project-view.ts";
export type { ArchiveTarget } from "./project-view.ts";
export type ArchiveOption = { title: string; description: string; activity?: number; value: ArchiveTarget };
const keyOf = (target: ArchiveTarget) => `${target.kind}:${target.id}`;

/** A batch is committed only by the explicit confirm button, never on a row click. */
export function ArchiveDialog(props: {
  context: Context;
  options: readonly ArchiveOption[];
  restoring: boolean;
  onConfirm: (targets: readonly ArchiveTarget[]) => void;
  onCancel: () => void;
}) {
  const theme = props.context.theme;
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = createSignal(0);
  // 0 search, 1 list, 2 all, 3 none, 4 cancel, 5 confirm.
  const [focus, setFocus] = createSignal(0);
  let root: BoxRenderable | undefined, input: InputRenderable | undefined, list: ScrollBoxRenderable | undefined;
  const visible = createMemo(() => props.options.filter((option) =>
    `${option.title} ${option.description}`.toLowerCase().includes(query().trim().toLowerCase())));
  const toggle = (option: ArchiveOption) => setSelected((current) => {
    const next = new Set(current), key = keyOf(option.value);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const confirm = () => {
    const targets = props.options.filter((option) => selected().has(keyOf(option.value))).map((option) => option.value);
    if (targets.length) props.onConfirm(targets);
  };
  const activate = (index: number) => {
    setFocus(index);
    if (index === 1) { const option = visible()[cursor()]; if (option) toggle(option); }
    if (index === 2) setSelected((current) => new Set([...current, ...visible().map((option) => keyOf(option.value))]));
    if (index === 3) setSelected(new Set<string>());
    if (index === 4) props.onCancel();
    if (index === 5) confirm();
  };
  createEffect(() => {
    const target = focus() === 0 ? input : root;
    queueMicrotask(() => { if (target && !target.isDestroyed) target.focus(); });
  });
  createEffect(() => {
    const option = visible()[cursor()];
    if (option) queueMicrotask(() => { if (list && !list.isDestroyed) list.scrollChildIntoView(`archive-${keyOf(option.value)}`); });
  });
  const onKeyDown = (event: KeyEvent) => {
    if (event.name === "escape") props.onCancel();
    else if (event.name === "tab") setFocus((value) => (value + (event.shift ? 5 : 1)) % 6);
    else if (event.ctrl && ["return", "enter"].includes(event.name)) confirm();
    else if (event.name === "down" || event.name === "up") {
      if (focus() === 0) setFocus(1);
      else if (focus() === 1) setCursor((value) => Math.max(0, Math.min(visible().length - 1, value + (event.name === "up" ? -1 : 1))));
      else setFocus((value) => (value + (event.name === "up" ? 5 : 1)) % 6);
    } else if (["return", "enter"].includes(event.name)) { if (focus() === 0) setFocus(1); else activate(focus()); }
    else if (event.name === "space" && focus() !== 0) activate(focus());
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  const button = (label: () => string, index: number) => {
    let pressed = false;
    return <box paddingX={1} backgroundColor={focus() === index ? theme.background.action.primary.focused : undefined}
      onMouseDown={(event) => { pressed = event.button === 0; event.preventDefault(); event.stopPropagation(); }}
      onMouseUp={(event) => { event.preventDefault(); event.stopPropagation(); if (pressed && event.button === 0) activate(index); pressed = false; }}
      onMouseDragEnd={() => { pressed = false; }}><text fg={focus() === index ? theme.text.action.primary.focused : index === 5 && !selected().size ? theme.text.muted : theme.text.base}><span style={{ bold: focus() === index }}>{focus() === index ? "› " : "  "}{label()}</span></text></box>;
  };
  return <box paddingX={2} paddingY={1} flexDirection="column" focusable ref={(element) => { root = element; }} onKeyDown={onKeyDown}
    onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
    <text fg={theme.text.base}><b>{props.restoring ? "Restore archived items" : "Archive items"}</b></text>
    <text fg={theme.text.muted} marginBottom={1}>Check multiple items, then confirm together. Nothing is deleted.</text>
    <input ref={(element) => { input = element; }} value={query()} placeholder="Search projects, sessions, or paths…"
      backgroundColor={theme.background.raised.high} textColor={theme.text.base}
      onInput={(value) => { setQuery(value); setCursor(0); }} onMouseDown={() => setFocus(0)} onKeyDown={onKeyDown} />
    <text fg={theme.text.muted}>{selected().size} selected · {visible().length} matching · selection survives search</text>
    <scrollbox ref={(element) => { list = element; }} height={Math.min(18, Math.max(3, props.options.length))} scrollX={false} scrollY contentOptions={{ flexDirection: "column" }}>
      <For each={visible()}>{(option, index) => <box id={`archive-${keyOf(option.value)}`} height={1} flexShrink={0} flexDirection="row" gap={1} paddingLeft={1}
        backgroundColor={focus() === 1 && cursor() === index() ? theme.background.raised.high : undefined}
        onMouseDown={(event) => { if (event.button === 0) { setFocus(1); setCursor(index()); toggle(option); } event.preventDefault(); event.stopPropagation(); }}>
        <text fg={focus() === 1 && cursor() === index() ? theme.text.feedback.info.base : theme.text.muted} flexShrink={0}>{focus() === 1 && cursor() === index() ? "›" : " "} {selected().has(keyOf(option.value)) ? "[x]" : "[ ]"}</text>
        <text fg={focus() === 1 && cursor() === index() ? theme.text.feedback.info.base : theme.text.base} flexGrow={1} minWidth={0} wrapMode="none" truncate><span style={{ bold: focus() === 1 && cursor() === index() }}>{option.title}</span></text>
        <text fg={theme.text.muted} maxWidth={25} flexShrink={1} minWidth={0} wrapMode="none" truncate>{option.description}</text>
        <text fg={theme.text.muted} flexShrink={0} wrapMode="none">{option.activity ? new Date(option.activity).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : option.value.kind === "project" ? "project" : "session"}</text>
      </box>}</For>
      <text fg={theme.text.muted}>{visible().length ? "" : "No matching items"}</text>
    </scrollbox>
    <box flexDirection="row" gap={1} marginTop={1}>{button(() => "Select all matching", 2)}{button(() => "Select none", 3)}</box>
    <box flexDirection="row" gap={1} marginTop={1}>{button(() => "Cancel", 4)}{button(() => `${props.restoring ? "Restore" : "Archive"} selected (${selected().size})`, 5)}</box>
    <text fg={theme.text.muted} marginTop={1}>Tab: controls · ↑/↓: move · Space: check · Ctrl+Enter: confirm · Esc: cancel</text>
  </box>;
}
