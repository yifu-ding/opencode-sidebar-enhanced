/**
 * Pure usage accounting: record shape, price lookup, aggregation, formatting.
 *
 * Kept free of filesystem and UI code so the numbers can be tested against the
 * Qoder dashboard without opening a terminal.
 */

export type Usage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** USD per 1M tokens, as stored by the Qoder estimator. */
export type Price = {
  readonly input: number;
  readonly output: number;
  readonly cache_read: number;
  readonly cache_write: number;
};

export type Pricing = { readonly models: Record<string, Price> };

export type Source = "qoder" | "codex" | "claude" | "opencode";

export type RequestRecord = {
  /** Stable identity within a source; duplicates across files are dropped on it. */
  readonly key: string;
  /** Epoch milliseconds, 0 when the log carried no timestamp. */
  readonly ts: number;
  /** Billing channel or model vendor, already human-readable. */
  readonly provider: string;
  /** Model id with any routing prefix stripped. */
  readonly model: string;
  readonly source: Source;
  readonly usage: Usage;
};

export type CostSplit = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
};

export type ModelUsage = {
  readonly model: string;
  readonly requests: number;
  readonly missingUsage: number;
  readonly usage: Usage;
  readonly cost: CostSplit;
  /** Any request in this group had no configured price. */
  readonly unpriced: boolean;
};

export type ProviderUsage = {
  readonly provider: string;
  readonly requests: number;
  readonly usage: Usage;
  readonly cost: CostSplit;
  readonly unpriced: boolean;
  readonly models: readonly ModelUsage[];
};

export type Report = {
  readonly providers: readonly ProviderUsage[];
  readonly total: ProviderUsage;
  readonly range: RangeKey;
};

/** 0 means "all time". */
export type RangeKey = 7 | 30 | 0;

export const RANGES: readonly RangeKey[] = [7, 30, 0];

export function rangeLabel(range: RangeKey) {
  return range === 0 ? "all" : `${range}d`;
}

/**
 * Model ids arrive decorated: `qoder-custom-<uuid>/gpt-6-astra`, or the routing
 * prefix Claude Code adds (`anthropic/claude-opus-5.5`). Pricing keys use the
 * bare name, so the prefix is always stripped for display and lookup.
 */
export function baseModel(model: string) {
  if (!model) return "unknown";
  const custom = model.match(/^qoder-custom-[0-9a-f-]{36}\/(.+)$/);
  if (custom) return custom[1] as string;
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/** `claude-opus-5.5`, `Claude-Opus-5-5` and `claude_opus_5_5` are one model. */
export function normalizeModel(model: string) {
  return model.trim().toLowerCase().replace(/[._]/g, "-");
}

function priceTable(pricing: Pricing) {
  const table = new Map<string, Price>();
  for (const [name, price] of Object.entries(pricing.models)) {
    table.set(normalizeModel(name), price);
  }
  return table;
}

export function priceFor(pricing: Pricing, model: string): Price | null {
  const exact = pricing.models[model];
  if (exact) return exact;
  const base = baseModel(model);
  const direct = pricing.models[base];
  if (direct) return direct;
  return priceTable(pricing).get(normalizeModel(base)) ?? null;
}

export function costSplit(price: Price, usage: Usage): CostSplit {
  const input = (usage.input * price.input) / 1e6;
  const output = (usage.output * price.output) / 1e6;
  const cacheRead = (usage.cacheRead * price.cache_read) / 1e6;
  const cacheWrite = (usage.cacheWrite * price.cache_write) / 1e6;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

const EMPTY_SPLIT: CostSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

function addSplit(left: CostSplit, right: CostSplit): CostSplit {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    total: left.total + right.total,
  };
}

/** Local calendar day, matching how the Qoder logs are grouped. */
export function localDay(ts: number) {
  if (!ts) return "unknown";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "unknown";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The first day a range includes, or null for all time. */
export function rangeStart(range: RangeKey, now = new Date()) {
  if (range === 0) return null;
  const start = new Date(now);
  start.setDate(start.getDate() - (range - 1));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

export function inRange(record: RequestRecord, from: string | null) {
  if (!from) return true;
  return localDay(record.ts) >= from;
}

/**
 * Drops records seen more than once. Claude Code copies a session's history into
 * every resumed transcript, so the same message id can appear in several files.
 */
export function dedupe(records: readonly RequestRecord[]) {
  const seen = new Set<string>();
  const out: RequestRecord[] = [];
  for (const record of records) {
    if (!record.key) {
      out.push(record);
      continue;
    }
    if (seen.has(record.key)) continue;
    seen.add(record.key);
    out.push(record);
  }
  return out;
}

type Bucket = {
  requests: number;
  missingUsage: number;
  usage: Usage;
  cost: CostSplit;
  unpriced: boolean;
};

function bucket(): Bucket {
  return { requests: 0, missingUsage: 0, usage: ZERO, cost: EMPTY_SPLIT, unpriced: false };
}

function accumulate(target: Bucket, record: RequestRecord, pricing: Pricing) {
  target.requests += 1;
  const usage = record.usage;
  target.usage = addUsage(target.usage, usage);
  const price = priceFor(pricing, record.model);
  if (!price) {
    target.unpriced = true;
    return;
  }
  target.cost = addSplit(target.cost, costSplit(price, usage));
}

/**
 * Groups every request under its provider, then its model, sorted by cost.
 * Providers and models with no requests are absent rather than rendered as $0.
 */
export function aggregate(
  records: readonly RequestRecord[],
  pricing: Pricing,
  options: { range: RangeKey; now?: Date },
): Report {
  const from = rangeStart(options.range, options.now ?? new Date());
  const byProvider = new Map<string, Map<string, Bucket>>();
  const total = bucket();

  for (const record of records) {
    if (!inRange(record, from)) continue;
    let models = byProvider.get(record.provider);
    if (!models) {
      models = new Map();
      byProvider.set(record.provider, models);
    }
    let modelBucket = models.get(record.model);
    if (!modelBucket) {
      modelBucket = bucket();
      models.set(record.model, modelBucket);
    }
    accumulate(modelBucket, record, pricing);
    accumulate(total, record, pricing);
  }

  const providers: ProviderUsage[] = [];
  for (const [provider, models] of byProvider) {
    const providerBucket = bucket();
    const rows: ModelUsage[] = [];
    for (const [model, modelBucket] of models) {
      providerBucket.requests += modelBucket.requests;
      providerBucket.usage = addUsage(providerBucket.usage, modelBucket.usage);
      providerBucket.cost = addSplit(providerBucket.cost, modelBucket.cost);
      providerBucket.unpriced ||= modelBucket.unpriced;
      rows.push({ model, ...modelBucket });
    }
    rows.sort((left, right) => right.cost.total - left.cost.total || right.requests - left.requests);
    providers.push({ provider, ...providerBucket, models: rows });
  }

  // A provider used only through unpriced models still matters, but a bare $0
  // group at the bottom of a short list is noise, so spend wins over volume.
  providers.sort(
    (left, right) => right.cost.total - left.cost.total || right.requests - left.requests,
  );

  return { providers, total: { provider: "total", ...total, models: [] }, range: options.range };
}

export function hitRate(usage: Usage) {
  const denominator = usage.input + usage.cacheRead + usage.cacheWrite;
  return denominator ? usage.cacheRead / denominator : null;
}

function group(value: number) {
  const [whole, fraction] = value.toFixed(2).split(".") as [string, string];
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export const fmt = {
  tokens(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(Math.round(value));
  },
  /** Precise enough for single days, short enough for a sidebar column. */
  money(value: number) {
    if (!Number.isFinite(value) || value === 0) return "$0";
    const absolute = Math.abs(value);
    if (absolute >= 0.01) return `$${group(value)}`;
    if (absolute >= 0.0001) return `$${value.toFixed(4)}`;
    return `<$0.0001`;
  },
  /** Sub-cent spend is common per model; keep three digits instead of zeros. */
  moneySmall(value: number) {
    if (!Number.isFinite(value) || value === 0) return "$0";
    const absolute = Math.abs(value);
    if (absolute >= 1) return `$${group(value)}`;
    if (absolute >= 0.01) return `$${value.toFixed(3)}`;
    if (absolute >= 0.0001) return `$${value.toFixed(4)}`;
    return "<$0.0001";
  },
  percent(value: number | null) {
    if (value === null) return "—";
    return `${(value * 100).toFixed(1)}%`;
  },
  /** `$10 / $50 / $1 / $12.5`, in the same order as the report columns. */
  price(price: Price) {
    const parts = [price.input, price.output, price.cache_read, price.cache_write].map((entry) =>
      String(Number(entry.toFixed(4))),
    );
    return parts.join(" / ");
  },
};