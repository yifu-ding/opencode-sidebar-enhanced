/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import { createMemo, For, Show } from "solid-js";
import { SidebarCard } from "./sidebar-card.tsx";
import { sessionTodos, type Todo } from "./todos.ts";

export function SidebarTodo(props: { context: Context; sessionID: string; open: boolean; onToggle: () => void }) {
  const theme = props.context.theme;
  const todos = createMemo(() => sessionTodos(
    props.context.data.session.message.list(props.sessionID) ?? [],
    props.context.data.session.get(props.sessionID)?.revert?.messageID,
  ));
  const remaining = () => todos().filter((todo) => todo.status === "pending" || todo.status === "in_progress").length;
  const color = (todo: Todo) => todo.status === "in_progress"
    ? theme.text.feedback.warning.base : theme.text.muted;
  const glyph = (todo: Todo) => ({ pending: "[ ]", in_progress: "[•]", completed: "[✓]", cancelled: "[-]" })[todo.status];
  return (
    <Show when={todos().length > 0}>
      <SidebarCard context={props.context}>
        <box flexDirection="row" gap={1} onMouseDown={(event) => {
          props.onToggle();
          event.preventDefault();
          event.stopPropagation();
        }}>
          <text fg={theme.text.base}><b>{props.open ? "▼" : "▶"} Todo</b></text>
          <Show when={!props.open}><text fg={theme.text.muted}>{remaining()} remaining</text></Show>
        </box>
        <Show when={props.open}>
          <For each={todos()}>{(todo) => (
            <box flexDirection="row" gap={1}>
              <text fg={color(todo)} flexShrink={0}>{glyph(todo)}</text>
              <text fg={color(todo)} wrapMode="word" flexGrow={1} minWidth={0}>
                <span style={{ strikethrough: todo.status === "cancelled" }}>{todo.content}</span>
              </text>
            </box>
          )}</For>
        </Show>
      </SidebarCard>
    </Show>
  );
}
