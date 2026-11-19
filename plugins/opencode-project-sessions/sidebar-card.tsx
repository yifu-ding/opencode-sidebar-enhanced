/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import { deepenBackground } from "./sidebar-color.ts";

/** Borderless card. Half/quarter blocks round the fill, not an outline. */
export function SidebarCard(props: { context: Context; children: JSX.Element }) {
  const [width, setWidth] = createSignal(0);
  let root: BoxRenderable | undefined;
  const fill = () => deepenBackground(props.context.theme.background.raised.base);
  const cap = (top: boolean) => {
    const cells = width();
    if (cells < 4) return (top ? "▄" : "▀").repeat(cells);
    return top
      ? ` ▗${"▄".repeat(cells - 4)}▖ `
      : ` ▝${"▀".repeat(cells - 4)}▘ `;
  };
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginBottom={-1}
      ref={(element) => { root = element; setWidth(element.width); }}
      onSizeChange={() => { if (root) setWidth(root.width); }}
    >
      <text height={1} flexShrink={0} fg={fill()} wrapMode="none">{cap(true)}</text>
      <box flexDirection="column" flexShrink={0} backgroundColor={fill()} paddingLeft={2} paddingRight={2}>
        {props.children}
      </box>
      <text height={1} flexShrink={0} fg={fill()} wrapMode="none">{cap(false)}</text>
    </box>
  );
}
