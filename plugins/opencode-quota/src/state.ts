/**
 * Owns the scan: when it runs, how often, and what the views read.
 *
 * The first pass of a cold cache reads ~800 transcripts; later passes only
 * stat them. Everything the UI shows is derived from two signals (rows and
 * prices), so switching the range never touches the disk.
 */

import { createMemo, createSignal, onCleanup } from "solid-js";

import type { Context } from "@opencode/plugin/tui/context";
import {
  canonicalModel,
  loadChannels,
  loadPricing,
  readCache,
  scan,
  writeCache,
  type CacheFile,
} from "./scan.ts";
import { aggregate, dedupe, type Pricing, type RangeKey, type RequestRecord } from "./usage.ts";

/** Transcripts only grow while another tool runs, so a slow tick is enough. */
const REFRESH_MS = 90_000;

export type ScanState = "loading" | "ready" | "error";

export type Usage = ReturnType<typeof useUsage>;

export function useUsage(context: Context) {
  const [settings, update] = context.storage.store<{ range: RangeKey; open: boolean }>("usage", {
    initial: { range: 30, open: true },
  });

  const [rows, setRows] = createSignal<readonly RequestRecord[]>([]);
  const [pricing, setPricing] = createSignal<Pricing>({ models: {} });
  const [state, setState] = createSignal<ScanState>("loading");
  const [error, setError] = createSignal<string>();
  const [updated, setUpdated] = createSignal(0);

  // Kept across passes so a refresh does not re-parse a multi-megabyte index.
  let cache: CacheFile | undefined;
  let running = false;
  let disposed = false;

  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      const [channels, prices] = await Promise.all([loadChannels(), loadPricing()]);
      const index = cache ?? (cache = await readCache());
      const { result, cache: next } = await scan({ cache: index, channels });
      cache = next;
      if (disposed) return;

      setPricing(prices);
      setRows(
        dedupe(result.records).map((record) => ({
          ...record,
          model: canonicalModel(prices, record.model),
        })),
      );
      setUpdated(Date.now());
      setError(undefined);
      setState("ready");
      void writeCache(next);
    } catch (cause) {
      if (disposed) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("error");
    } finally {
      running = false;
    }
  };

  void refresh();
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
  });

  const report = createMemo(() => aggregate(rows(), pricing(), { range: settings.range }));

  const setRange = (range: RangeKey) => void update((draft) => void (draft.range = range));

  /** Cycles 7 days, 30 days, all time — the only control the sidebar has room for. */
  const cycleRange = () =>
    setRange(settings.range === 7 ? 30 : settings.range === 30 ? 0 : 7);

  const toggleOpen = () => void update((draft) => void (draft.open = !draft.open));

  return {
    report,
    pricing,
    state,
    error,
    updated,
    range: () => settings.range,
    open: () => settings.open,
    setRange,
    cycleRange,
    toggleOpen,
    refresh,
  };
}