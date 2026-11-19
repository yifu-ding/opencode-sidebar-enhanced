/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import { deepenBackground } from "./sidebar-color.ts";

/** Borderless theme-toned card, rounded with background-fill block glyphs. */
export function SidebarCard(props: { context: Context; children: JSX.Element }) {
  const [width, setWidth] = createSignal(0);
  let root: BoxRenderable | undefined;
  const fill = () => deepenBackground(props.context.theme.background.raised.base);
  const cap = (top: boolean) => width() < 4
    ? (top ? "▄" : "▀").repeat(width())
    : top ? ` ▗${"▄".repeat(width() - 4)}▖ ` : ` ▝${"▀".repeat(width() - 4)}▘ `;
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={-1}
      ref={(element) => { root = element; setWidth(element.width); }}
      onSizeChange={() => { if (root) setWidth(root.width); }}>
      <text height={1} flexShrink={0} fg={fill()} wrapMode="none">{cap(true)}</text>
      <box flexDirection="column" flexShrink={0} backgroundColor={fill()} paddingLeft={2} paddingRight={2}>{props.children}</box>
      <text height={1} flexShrink={0} fg={fill()} wrapMode="none">{cap(false)}</text>
    </box>
  );
}
