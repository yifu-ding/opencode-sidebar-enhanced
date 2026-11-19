import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregate,
  baseModel,
  costSplit,
  dedupe,
  fmt,
  hitRate,
  normalizeModel,
  priceFor,
  rangeLabel,
  type Pricing,
  type RequestRecord,
} from "./usage.ts";

const pricing: Pricing = {
  models: {
    "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
    "gemini-3-pro": { input: 2, output: 12, cache_read: 0.25, cache_write: 0 },
  },
};

function record(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    key: Math.random().toString(36),
    ts: Date.now(),
    provider: "ZenMux",
    model: "claude-opus-5-5",
    source: "claude",
    usage: { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...overrides,
  };
}

test("model ids lose their routing prefix but keep their case", () => {
  assert.equal(baseModel("anthropic/claude-opus-5.5"), "claude-opus-5.5");
  assert.equal(baseModel("qoder-custom-1ae5767b-1111-2222-3333-444455556666/gpt-6-astra"), "gpt-6-astra");
  assert.equal(baseModel("gpt-6-astra"), "gpt-6-astra");
  assert.equal(baseModel(""), "unknown");
});

test("prices match regardless of separators and case", () => {
  assert.equal(priceFor(pricing, "claude-opus-5-5")?.input, 4);
  assert.equal(priceFor(pricing, "Claude-Opus-5.5")?.input, 4);
  assert.equal(priceFor(pricing, "anthropic/claude_opus_5_5")?.input, 4);
  assert.equal(priceFor(pricing, "gpt-6.2-sol"), null);
  assert.equal(normalizeModel("Claude.Opus_5.5"), "claude-opus-5-5");
});

test("cost splits per token class", () => {
  const split = costSplit(pricing.models["claude-opus-5-5"]!, {
    input: 1e6,
    output: 1e6,
    cacheRead: 1e6,
    cacheWrite: 1e6,
  });
  assert.equal(split.input, 4);
  assert.equal(split.output, 20);
  assert.equal(split.cacheRead, 0.2);
  assert.equal(split.cacheWrite, 5);
  assert.equal(split.total, 29.2);
});

test("duplicate message ids collapse, from one tool only", () => {
  const kept = dedupe([
    record({ key: "a" }),
    record({ key: "a" }),
    record({ key: "b" }),
  ]);
  assert.equal(kept.length, 2);
});

test("records with no key are all kept", () => {
  assert.equal(dedupe([record({ key: "" }), record({ key: "" })]).length, 2);
});

test("a range excludes older days but keeps today", () => {
  const now = new Date(2026, 10, 19, 12);
  const today = new Date(2026, 10, 19, 9).getTime();
  const weekAgo = new Date(2026, 10, 13, 9).getTime();
  const old = new Date(2026, 10, 10, 9).getTime();

  const week = aggregate(
    [record({ ts: today }), record({ ts: weekAgo }), record({ ts: old })],
    pricing,
    { range: 7, now },
  );
  assert.equal(week.total.requests, 2);

  const all = aggregate(
    [record({ ts: today }), record({ ts: weekAgo }), record({ ts: old })],
    pricing,
    { range: 0, now },
  );
  assert.equal(all.total.requests, 3);
});

test("providers group their models and sort by spend", () => {
  const report = aggregate(
    [
      record({ provider: "cch", model: "gemini-3-pro", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }),
      record({ provider: "ZenMux" }),
      record({ provider: "ZenMux", model: "gemini-3-pro" }),
    ],
    pricing,
    { range: 0 },
  );

  assert.deepEqual(
    report.providers.map((provider) => provider.provider),
    ["ZenMux", "cch"],
  );
  assert.equal(report.providers[0]!.models.length, 2);
  // The first record is a zero-token call, so only the two real ones cost.
  assert.equal(report.total.cost.total, 4 + 2);
});

test("unpriced models are flagged, not silently free", () => {
  const report = aggregate([record({ model: "gpt-6.2-sol" })], pricing, { range: 0 });
  assert.equal(report.total.cost.total, 0);
  assert.equal(report.total.unpriced, true);
});

test("cache hit rate counts reads against all fresh input", () => {
  assert.equal(hitRate({ input: 50, output: 0, cacheRead: 50, cacheWrite: 0 }), 0.5);
  assert.equal(hitRate({ input: 0, output: 10, cacheRead: 0, cacheWrite: 0 }), null);
});

test("money keeps cents above a dollar", () => {
  assert.equal(fmt.money(1234.5678), "$1,234.57");
  assert.equal(fmt.money(0.5), "$0.50");
  assert.equal(fmt.money(0), "$0");
});

test("per-model money keeps a readable number for fractions of a cent", () => {
  assert.equal(fmt.moneySmall(0.0123), "$0.012");
  assert.equal(fmt.moneySmall(0.0005), "$0.0005");
  assert.equal(fmt.moneySmall(2.5), "$2.50");
});

test("range labels read as short suffixes", () => {
  assert.equal(rangeLabel(7), "7d");
  assert.equal(rangeLabel(0), "all");
});