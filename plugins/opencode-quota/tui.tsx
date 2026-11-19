/** @jsxImportSource @opentui/solid */
import { SidebarCard } from "./sidebar-card.tsx";
import { header, layout, line } from "./src/table.ts";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { KeyEvent, MouseEvent } from "@opentui/core";
import { createMemo, createSignal, For, Show } from "solid-js";

import { useUsage, type Usage } from "./src/state.ts";
import { fmt, hitRate, RANGES, rangeLabel, type ProviderUsage, type RangeKey } from "./src/usage.ts";

/**
 * Cost list for every coding agent on this machine, in the sidebar footer.
 *
 * Collapsed, it is a bullet list of suppliers with the models underneath and
 * one number each. The full-screen view adds the split behind each number:
 * input, output, cache reads, cache writes, and the unit price.
 */

// Mirrors OpenTUI's MouseButton values, so no runtime OpenTUI import is needed.
const LEFT = 0;
const RIGHT = 2;

/** Models shown per supplier before the list is folded into "+N more". */
const MODELS_PER_PROVIDER = 2;

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

function ago(time: number, now = Date.now()) {
  if (!time) return "syncing…";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/** `$2,105.72` is too wide for a 40-column sidebar; drop cents above $1k. */
function shortMoney(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}k`;
  return fmt.money(value);
}

function totalCost(usage: ProviderUsage) {
  return usage.cost.total;
}

/**
 * One supplier and the models it billed.
 *
 * A supplier with more models than fit keeps the cheapest ones behind "+N";
 * the row itself expands the list in place rather than opening a dialog.
 */
function ProviderBlock(props: {
  context: Context;
  provider: ProviderUsage;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const theme = props.context.theme;
  const [hovered, setHovered] = createSignal(false);
  const models = () =>
    props.expanded ? props.provider.models : props.provider.models.slice(0, MODELS_PER_PROVIDER);
  const hidden = () => Math.max(0, props.provider.models.length - models().length);

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
        <text fg={theme.text.muted} flexShrink={0}>
          {hidden() > 0 || props.expanded ? (props.expanded ? "▾" : "▸") : "•"}
        </text>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
          <b>{props.provider.provider}</b>
        </text>
        <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
          {shortMoney(totalCost(props.provider))}
          <Show when={props.provider.unpriced}>
            <span style={{ fg: theme.text.feedback.warning.base }}>*</span>
          </Show>
        </text>
      </box>
      <For each={models()}>
        {(model) => (
          <box
            flexDirection="row"
            gap={1}
            paddingLeft={2}
            onMouseOver={() => undefined}
            {...clickable({ left: props.onOpen })}
          >
            <text fg={theme.text.muted} flexShrink={0}>
              ·
            </text>
            <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
              {model.model}
            </text>
            <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
              {shortMoney(model.cost.total)}
            </text>
          </box>
        )}
      </For>
      <Show when={hidden() > 0}>
        <box flexDirection="row" gap={1} paddingLeft={3} {...clickable({ left: props.onToggle })}>
          <text fg={theme.text.muted}>+{hidden()} more</text>
        </box>
      </Show>
    </box>
  );
}

function Sidebar(props: { context: Context; usage: Usage; onOpen: () => void }) {
  const context = props.context;
  const theme = context.theme;
  const [expanded, setExpanded] = createSignal<readonly string[]>([]);

  const report = () => props.usage.report();
  const isExpanded = (provider: string) => expanded().includes(provider);
  const toggle = (provider: string) =>
    setExpanded((current) =>
      current.includes(provider) ? current.filter((entry) => entry !== provider) : [...current, provider],
    );

  const summary = () => {
    if (props.usage.state() === "error") return "could not read logs";
    if (props.usage.state() === "loading") return "reading transcripts…";
    const total = report().total;
    return `${total.requests.toLocaleString()} req · ${ago(props.usage.updated())}`;
  };

  return (
    <SidebarCard context={context}>
      {/* Header: fold, range, spend. Everything else in this block is a list. */}
      <box flexDirection="row" gap={1}>
        <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} {...clickable({ left: props.usage.toggleOpen })}>
          <text fg={theme.text.base} flexShrink={0}>
            {props.usage.open() ? "▼" : "▶"}
          </text>
          <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
            <b>Usage</b>
          </text>
        </box>
        <text fg={theme.text.muted} flexShrink={0} {...clickable({ left: props.usage.cycleRange })}>
          {rangeLabel(props.usage.range())}
        </text>
        <text fg={theme.text.base} flexShrink={0} {...clickable({ left: props.onOpen })}>
          <b>{shortMoney(report().total.cost.total)}</b>
        </text>
      </box>

      <Show when={props.usage.open()}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {summary()}
        </text>
        <Show
          when={report().providers.length > 0}
          fallback={
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {props.usage.state() === "ready" ? "no usage in this range" : " "}
            </text>
          }
        >
          <For each={report().providers}>
            {(provider) => (
              <ProviderBlock
                context={context}
                provider={provider}
                expanded={isExpanded(provider.provider)}
                onToggle={() => toggle(provider.provider)}
                onOpen={props.onOpen}
              />
            )}
          </For>
        </Show>
      </Show>
    </SidebarCard>
  );
}

function RangeTab(props: { context: Context; range: RangeKey; active: boolean; onPick: () => void }) {
  const theme = props.context.theme;
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.active ? theme.background.raised.high : undefined}
      {...clickable({ left: props.onPick })}
    >
      <text fg={props.active ? theme.text.base : theme.text.muted}>
        {props.active ? <b>{rangeLabel(props.range)}</b> : rangeLabel(props.range)}
      </text>
    </box>
  );
}

/**
 * Full-screen breakdown.
 *
 * Same grouping as the sidebar, one line per model, with the four token
 * classes and the unit price behind each cost. Unpriced models stay visible
 * with `*` rather than a silent zero.
 */
function Panel(props: { context: Context; usage: Usage; width: number; onClose: () => void }) {
  const context = props.context;
  const theme = context.theme;
  const report = () => props.usage.report();
  const total = () => report().total;
  const pricing = (model: string) => props.usage.pricing().models[model];

  // The host publishes the panel width reactively; sizing the table from it keeps
  // every number under its own heading on any terminal.
  const col = createMemo(() => layout(Math.max(0, props.width - 4)));

  const onKeyDown = (event: KeyEvent) => {
    switch (event.name) {
      case "escape":
      case "q":
        return props.onClose();
      case "left":
        return props.usage.setRange(RANGES[Math.max(0, RANGES.indexOf(props.usage.range()) - 1)]!);
      case "right":
        return props.usage.setRange(RANGES[Math.min(RANGES.length - 1, RANGES.indexOf(props.usage.range()) + 1)]!);
      case "r":
        return void props.usage.refresh();
      default:
        return;
    }
  };

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      focusable
      backgroundColor={theme.background.base}
      ref={(element) => queueMicrotask(() => element.focus())}
      onKeyDown={onKeyDown}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          <b>Usage</b>
          <span style={{ fg: theme.text.muted }}>{`  ${total().requests.toLocaleString()} requests · ${ago(props.usage.updated())}`}</span>
        </text>
        <box flexDirection="row" gap={0} flexShrink={0}>
          <For each={RANGES}>
            {(range) => (
              <RangeTab
                context={context}
                range={range}
                active={props.usage.range() === range}
                onPick={() => props.usage.setRange(range)}
              />
            )}
          </For>
        </box>
        <text fg={theme.text.base} flexShrink={0}>
          <b>{fmt.money(total().cost.total)}</b>
        </text>
        <text
          fg={theme.text.muted}
          flexShrink={0}
          paddingLeft={1}
          {...clickable({ left: props.onClose })}
        >
          esc
        </text>
      </box>

      {/* Token totals stay here, so the table below is only about money. */}
      <text fg={theme.text.muted} flexShrink={0} wrapMode="none" truncate>
        {`in ${fmt.tokens(total().usage.input)}   out ${fmt.tokens(total().usage.output)}   cache read ${fmt.tokens(total().usage.cacheRead)}   cache write ${fmt.tokens(total().usage.cacheWrite)}   hit ${fmt.percent(hitRate(total().usage))}`}
      </text>

      <box paddingTop={1} flexShrink={0}>
        <text fg={theme.text.muted} wrapMode="none">
          {header(col())}
        </text>
      </box>

      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <For each={report().providers}>
          {(provider) => (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.text.base} wrapMode="none">
                <b>
                  {line(
                    {
                      name: provider.provider,
                      cost: fmt.money(provider.cost.total),
                      input: fmt.money(provider.cost.input),
                      output: fmt.money(provider.cost.output),
                      cacheRead: fmt.money(provider.cost.cacheRead),
                      cacheWrite: fmt.money(provider.cost.cacheWrite),
                      hit: fmt.percent(hitRate(provider.usage)),
                      unit: "",
                    },
                    col(),
                  )}
                </b>
              </text>
              <For each={provider.models}>
                {(model) => {
                  const price = pricing(model.model);
                  return (
                    <text
                      fg={model.cost.total === 0 ? theme.text.muted : theme.text.base}
                      wrapMode="none"
                    >
                      {line(
                        {
                          name: `  ${model.model}${model.unpriced ? "*" : ""}`,
                          cost: fmt.money(model.cost.total),
                          input: fmt.money(model.cost.input),
                          output: fmt.money(model.cost.output),
                          cacheRead: fmt.money(model.cost.cacheRead),
                          cacheWrite: fmt.money(model.cost.cacheWrite),
                          hit: fmt.percent(hitRate(model.usage)),
                          unit: price ? fmt.price(price) : "no price set",
                        },
                        col(),
                      )}
                    </text>
                  );
                }}
              </For>
            </box>
          )}
        </For>
      </box>

      <text fg={theme.text.muted} flexShrink={0} paddingTop={1} wrapMode="none" truncate>
        {`${fmt.money(total().cost.total)} total  ·  costs are split by token class  ·  * unpriced model  ·  ← → range  ·  r rescan  ·  esc close`}
      </text>
    </box>
  );
}

export default Plugin.define({
  id: "opencode.quota",
  setup(context) {
    const usage = useUsage(context);
    const [sidebar, setSidebar] = context.storage.store<{ hidden: boolean }>("sidebar", { initial: { hidden: false } });

    const open = () => {
      context.ui.dialog.clear();
      if (context.ui.panel.current()?.name === "quota") {
        context.ui.panel.close();
        return;
      }
      // The sidebar lives only in a session, but the palette can be invoked from
      // home; a home route has no panel to claim, so say so instead of failing.
      if (!context.ui.panel.open("quota", { presentation: "fullscreen" })) {
        context.ui.toast.show({
          title: "Usage",
          message:
            context.ui.router.current().type === "session"
              ? "This TUI does not expose the session panel."
              : "Open a session to see the full breakdown.",
          variant: "info",
          duration: 2000,
        });
      }
    };

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        ...[true, false].map((visible) => ({
          id: `quota.sidebar.${visible ? "open" : "close"}`,
          title: `Sidebar: ${visible ? "show" : "hide"} Usage`, group: "Sidebar", palette: true as const,
          slash: { name: `sidebar-usage-${visible ? "open" : "close"}` },
          run: () => {
            void setSidebar((draft) => { draft.hidden = !visible; });
            if (visible && !usage.open()) usage.toggleOpen();
          },
        })),
        {
          id: "quota.open",
          title: "Quota: cost breakdown",
          description: "Every model's spend across Qoder, Codex, and Claude Code",
          group: "Quota",
          palette: true,
          slash: { name: "quota" },
          run: () => open(),
        },
        {
          id: "quota.range",
          title: "Quota: cycle time range",
          group: "Quota",
          palette: true,
          run: () => usage.cycleRange(),
        },
        {
          id: "quota.refresh",
          title: "Quota: rescan transcripts",
          group: "Quota",
          palette: true,
          run: () => void usage.refresh(),
        },
      ],
    }));

    context.ui.slot({
      append: "sidebar.footer",
      render: () => <Show when={!sidebar.hidden}><Sidebar context={context} usage={usage} onOpen={open} /></Show>,
    });

    context.ui.slot({
      append: "session.panel",
      render: (input) => {
        if (input.name !== "quota") return <></>;
        if (!input.focused) queueMicrotask(() => input.focus());
        return <Panel context={context} usage={usage} width={input.width} onClose={() => input.close()} />;
      },
    });
  },
});
