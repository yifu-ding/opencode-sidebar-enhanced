/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { createMemo, Show } from "solid-js";

/**
 * Context meter for the line under the input box.
 *
 * That line already prints "79.2K (40%)", but nothing names the number and there
 * is no bar. This claims `prompt.footer.status` — the same anchor opencode-dcp
 * uses for its `DCP −72% outbound` note, which already sits right beside the
 * usage text — and puts `Context ██░░` there so the figure reads at a glance.
 *
 * When the footer shows details it owns the numbers, so this prints only the
 * label and the bar; when it collapses (narrow terminals) this adds its own
 * "79.2K (40%)" so the information never disappears.
 *
 * The token math mirrors the built-in panels and opencode-dcp: take the last
 * assistant message after the last completed compaction (and before any revert
 * point) and sum input + output + reasoning + cache read/write.
 */

/** Cells the bar occupies. Short enough to sit in a one-line footer. */
const BAR_WIDTH = 10;
/** Shade used for the used part of the bar. */
const FULL_CELL = "█";
/** Shade used for the headroom part of the bar. */
const EMPTY_CELL = "░";

type Usage = {
  readonly tokens: number;
  readonly limit?: number;
  readonly percent?: number;
};

type TokenCounts = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: { readonly read: number; readonly write: number };
};

/** Structural view of the bits of a message this plugin reads. */
type AssistantLike = {
  readonly id: string;
  readonly type: string;
  readonly status?: string;
  readonly model?: { readonly id: string; readonly providerID: string };
  readonly tokens?: TokenCounts;
};

function total(usage: TokenCounts) {
  return (
    usage.input +
    usage.output +
    usage.reasoning +
    usage.cache.read +
    usage.cache.write
  );
}

function usage(context: Context, sessionID: string): Usage | undefined {
  const session = context.data.session.get(sessionID);
  if (!session) return undefined;
  const messages = (context.data.session.message.list(sessionID) ??
    []) as unknown as readonly AssistantLike[];

  // A revert hides everything from that message on, so the window ends there.
  let end = messages.length;
  const revert = session.revert?.messageID;
  if (revert) {
    const index = messages.findIndex((message) => message.id === revert);
    if (index >= 0) end = index;
  }

  // Everything before the last completed compaction is no longer in the window.
  let compacted = -1;
  for (let index = 0; index < end; index++) {
    const message = messages[index];
    if (message?.type === "compaction" && message.status === "completed")
      compacted = index;
  }

  let last: AssistantLike | undefined;
  for (let index = end - 1; index > compacted; index--) {
    const message = messages[index];
    if (message?.type === "assistant" && message.tokens) {
      last = message;
      break;
    }
  }
  if (!last?.tokens) return undefined;

  const tokens = total(last.tokens);
  if (tokens <= 0) return undefined;

  const model = last.model
    ? context.data.location.model
        .list(session.location)
        ?.find(
          (candidate) =>
            candidate.providerID === last?.model?.providerID &&
            candidate.id === last?.model?.id,
        )
    : undefined;
  const limit = model?.limit.context;

  return {
    tokens,
    limit,
    percent:
      limit && limit > 0 ? Math.round((tokens / limit) * 100) : undefined,
  };
}

/** 79153 -> "79.2K", 1200000 -> "1.2M". */
function short(value: number) {
  const trim = (text: string) => (text.endsWith(".0") ? text.slice(0, -2) : text);
  if (value >= 1_000_000) return `${trim((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${trim((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function bar(percent: number) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return {
    filled: FULL_CELL.repeat(filled),
    empty: EMPTY_CELL.repeat(Math.max(0, BAR_WIDTH - filled)),
  };
}

function ContextBar(props: {
  context: Context;
  sessionID: string;
  showDetails: boolean;
}) {
  const context = props.context;
  const theme = context.theme;
  const current = createMemo(() => usage(context, props.sessionID));

  return (
    <Show when={current()}>
      {(value: () => Usage) => (
        <text wrapMode="none" flexShrink={0}>
          <span style={{ fg: theme.text.muted }}>Context </span>
          <span style={{ fg: theme.text.base }}>
            {bar(value().percent ?? 0).filled}
          </span>
          <span style={{ fg: theme.text.muted }}>
            {bar(value().percent ?? 0).empty}
          </span>
          <Show when={!props.showDetails}>
            <span style={{ fg: theme.text.muted }}>
              {" "}
              {short(value().tokens)}
              {value().percent !== undefined ? ` (${value().percent}%)` : ""}
            </span>
          </Show>
          <span> </span>
        </text>
      )}
    </Show>
  );
}

export default Plugin.define({
  id: "yifuding.context-bar",
  setup(context) {
    context.ui.slot({
      // Lands inside the footer row, immediately left of the default
      // "79.2K (40%)" usage text. Shell mode hides the default numbers, so the
      // bar steps aside there rather than floating alone.
      append: "prompt.footer.status",
      render: (input) => (
        <Show
          when={
            input.mode === "normal" && input.sessionID ? input.sessionID : undefined
          }
        >
          {(sessionID: () => string) => (
            <ContextBar
              context={context}
              sessionID={sessionID()}
              showDetails={input.showDetails}
            />
          )}
        </Show>
      ),
    });
  },
});