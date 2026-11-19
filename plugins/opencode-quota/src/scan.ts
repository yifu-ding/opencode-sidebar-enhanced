import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FALLBACK_PRICING, type PriceTable } from "./prices.ts";
import { baseModel, normalizeModel, type Pricing, type Price, type RequestRecord } from "./usage.ts";

/** Where each tool keeps its transcripts. All three are plain JSONL trees. */
export const HOME = os.homedir();

export const QODER_ROOT = path.join(HOME, ".qoder-cn", "projects");
export const QODER_SETTINGS = path.join(HOME, ".qoder-cn", "settings.json");
export const CODEX_ROOT = path.join(HOME, ".codex", "sessions");
export const CODEX_CONFIG = path.join(HOME, ".codex", "config.toml");
export const CLAUDE_ROOT = path.join(HOME, ".claude", "projects");
export const CLAUDE_SETTINGS = path.join(HOME, ".claude", "settings.json");
export const PRICING_FILE = path.join(HOME, ".qoder-usage", "pricing.json");
export const CC_SWITCH_PRICING = path.join(HOME, ".cc-switch", "model-pricing.json");

export const CACHE_DIR = path.join(
  process.env.XDG_CACHE_HOME || path.join(HOME, ".cache"),
  "opencode-quota",
);

async function readJSON(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Prices come from the Qoder estimator first, because that file is the one the
 * user edits; cc-switch's table adds models Qoder never listed, and the bundled
 * table covers everything else.
 */
export async function loadPricing(): Promise<Pricing> {
  const models: Record<string, Price> = { ...FALLBACK_PRICING };

  const ccSwitch = (await readJSON(CC_SWITCH_PRICING)) as
    | { models?: Array<Record<string, unknown>> }
    | undefined;
  for (const entry of ccSwitch?.models ?? []) {
    const id = entry.modelId;
    if (typeof id !== "string") continue;
    const number = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    models[id] = {
      input: number(entry.inputCostPerMillion),
      output: number(entry.outputCostPerMillion),
      cache_read: number(entry.cacheReadCostPerMillion),
      cache_write: number(entry.cacheCreationCostPerMillion),
    };
  }

  const qoder = (await readJSON(PRICING_FILE)) as { models?: PriceTable } | undefined;
  for (const [name, price] of Object.entries(qoder?.models ?? {})) {
    if (typeof price?.input !== "number") continue;
    models[name] = price;
  }

  return { models };
}

/** Hostnames are not useful names; the two proxies the user actually pays are. */
export function providerLabel(baseUrl: string | undefined, fallback = "OpenAI"): string {
  if (!baseUrl) return fallback;
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
  if (host === "zenmux.ai" || host.endsWith(".zenmux.ai")) return "ZenMux";
  if (host === "code.aiserverai.online") return "cch";
  if (host === "openai.com" || host.endsWith(".openai.com")) return "OpenAI";
  if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "OpenAI";
  if (host === "anthropic.com" || host.endsWith(".anthropic.com")) return "Anthropic";
  const providers: Record<string, string> = {
    "googleapis.com": "Google", "deepseek.com": "DeepSeek", "openrouter.ai": "OpenRouter",
    "groq.com": "Groq", "mistral.ai": "Mistral", "x.ai": "xAI", "cohere.com": "Cohere",
    "moonshot.cn": "Moonshot", "moonshot.ai": "Moonshot", "siliconflow.cn": "SiliconFlow",
    "siliconflow.com": "SiliconFlow", "together.xyz": "Together AI", "fireworks.ai": "Fireworks AI",
    "dashscope.aliyuncs.com": "Alibaba Cloud", "openai.azure.com": "Azure OpenAI",
  };
  for (const [domain, name] of Object.entries(providers)) if (host === domain || host.endsWith(`.${domain}`)) return name;
  return host;
}

export type Channels = {
  /** Qoder provider id -> channel. */
  readonly qoderById: Map<string, string>;
  /** Qoder model id -> channel, used when a log predates the provider field. */
  readonly qoderByModel: Map<string, string>;
  /** Codex `[model_providers.<name>]` -> channel. */
  readonly codexByName: Map<string, string>;
  /** Claude Code has one base URL for all traffic. */
  readonly claude: string;
};

export async function loadChannels(): Promise<Channels> {
  const qoderById = new Map<string, string>();
  const qoderByModel = new Map<string, string>();

  const settings = (await readJSON(QODER_SETTINGS)) as
    | { providers?: Record<string, { name?: string; baseUrl?: string; model?: string; models?: Array<{ model?: string }> }> }
    | undefined;
  for (const [id, provider] of Object.entries(settings?.providers ?? {})) {
    const label = providerLabel(provider.baseUrl, provider.name || id);
    qoderById.set(id, label);
    if (provider.model) qoderByModel.set(provider.model, label);
    for (const model of provider.models ?? []) {
      if (model.model) qoderByModel.set(model.model, label);
    }
  }

  const codexByName = new Map<string, string>();
  try {
    const toml = await readFile(CODEX_CONFIG, "utf8");
    let current: string | null = null;
    for (const line of toml.split("\n")) {
      const section = line.match(/^\s*\[model_providers\.([^\]]+)\]/);
      if (section) {
        current = (section[1] as string).trim().replace(/^["']|["']$/g, "");
        codexByName.set(current, /^(openai|openai_http)$/i.test(current) ? "OpenAI" : current);
        continue;
      }
      if (/^\s*\[/.test(line)) {
        current = null;
        continue;
      }
      if (!current) continue;
      const name = line.match(/^\s*name\s*=\s*"([^"]+)"/);
      if (name) codexByName.set(current, name[1] as string);
      const baseUrl = line.match(/^\s*base_url\s*=\s*"([^"]+)"/);
      if (baseUrl) codexByName.set(current, providerLabel(baseUrl[1]));
    }
  } catch {
    // No Codex config: every session keeps the generic label.
  }

  const claudeSettings = (await readJSON(CLAUDE_SETTINGS)) as
    | { env?: Record<string, string> }
    | undefined;
  const claude = providerLabel(claudeSettings?.env?.ANTHROPIC_BASE_URL, "Anthropic");

  return { qoderById, qoderByModel, codexByName, claude };
}

/** A record as stored in the cache: eight flat fields instead of named ones. */
export type PackedRecord = [
  ts: number,
  channel: string,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  key: string,
];

export function pack(record: RequestRecord): PackedRecord {
  return [
    record.ts,
    record.provider,
    record.model,
    record.usage.input,
    record.usage.output,
    record.usage.cacheRead,
    record.usage.cacheWrite,
    record.key,
  ];
}

export function unpack(row: PackedRecord, source: RequestRecord["source"]): RequestRecord {
  return {
    // Source-prefixed so two tools that happen to use the same message id
    // shape can never collapse into one request.
    key: `${source}:${row[7]}`,
    ts: row[0],
    provider: row[1],
    model: row[2],
    source,
    usage: { input: row[3], output: row[4], cacheRead: row[5], cacheWrite: row[6] },
  };
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestamp(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

function normalizeUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const usage = {
    input: num(source.input_tokens),
    output: num(source.output_tokens),
    cacheRead: num(source.cache_read_input_tokens),
    cacheWrite: num(source.cache_creation_input_tokens),
  };
  if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0) return null;
  return usage;
}

/**
 * Qoder writes one JSONL per session. Only assistant turns carry usage, and a
 * turn can be appended twice while streaming, so they are keyed by message id.
 */
export function parseQoderFile(text: string, channels: Channels): PackedRecord[] {
  const seen = new Map<string, PackedRecord>();
  let runtimeModel = "";

  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"runtime-config"')) continue;

    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "runtime-config") {
      if (typeof entry.model === "string") runtimeModel = entry.model;
      continue;
    }
    if (entry.type !== "assistant") continue;

    const message = entry.message ?? {};
    if (message.model === "<synthetic>") continue;
    const key = message.id ?? entry.uuid;
    if (typeof key !== "string") continue;
    // Qoder logs a row per routed attempt, and the router's own attempts carry
    // no usage. Those rows are not billable requests: counting them would
    // triple the request total without adding a single dollar.
    if (seen.has(key)) continue;
    const usage = normalizeUsage(message.usage);
    if (!usage) continue;

    const model = String(message.model || runtimeModel || "unknown");
    seen.set(key, [
      timestamp(entry.timestamp),
      qoderChannel(model, channels),
      baseModel(model),
      usage.input,
      usage.output,
      usage.cacheRead,
      usage.cacheWrite,
      key,
    ]);
  }

  return [...seen.values()];
}

function qoderChannel(model: string, channels: Channels) {
  const routed = model.match(/^(qoder-custom-[0-9a-f-]{36})\//);
  if (routed) {
    const label = channels.qoderById.get(routed[1] as string);
    if (label) return label;
  }
  return channels.qoderByModel.get(baseModel(model)) ?? "未知";
}

/**
 * Codex rollouts record a running `token_count` per turn. Its `input_tokens`
 * already includes the cached part, so the cached share is subtracted to keep
 * "input" meaning new tokens, as every other source does.
 */
export function parseCodexFile(text: string, channels: Channels): PackedRecord[] {
  const out: PackedRecord[] = [];
  let providerName: string | null = null;
  let model = "unknown";
  let sessionId = "";
  let index = 0;

  for (const line of text.split("\n")) {
    index += 1;
    if (!line.startsWith("{")) continue;
    if (!line.includes('"session_meta"') && !line.includes('"token_count"') && !line.includes('"turn_context"')) {
      continue;
    }

    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry.payload ?? {};

    if (entry.type === "session_meta") {
      if (payload.model_provider) providerName = payload.model_provider;
      if (payload.session_id || payload.id) sessionId = payload.session_id ?? payload.id;
      continue;
    }
    if (entry.type === "turn_context") {
      if (payload.model) model = payload.model;
      if (payload.model_provider) providerName = payload.model_provider;
      continue;
    }
    if (entry.type !== "event_msg" || payload.type !== "token_count") continue;

    const usage = payload.info?.last_token_usage;
    if (!usage) continue;
    const cached = num(usage.cached_input_tokens);
    const cacheWrite = num(usage.cache_write_input_tokens);
    const input = Math.max(0, num(usage.input_tokens) - cached - cacheWrite);
    const output = num(usage.output_tokens);
    if (input + output + cached + cacheWrite === 0) continue;

    out.push([
      timestamp(entry.timestamp),
      providerName ? channels.codexByName.get(providerName) ?? (/^(openai|openai_http)$/i.test(providerName) ? "OpenAI" : providerName) : "OpenAI",
      baseModel(model),
      input,
      output,
      cached,
      cacheWrite,
      `${sessionId}:${entry.ordinal ?? index}`,
    ]);
  }

  return out;
}

export function parseClaudeFile(text: string, channels: Channels): PackedRecord[] {
  const out: PackedRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;

    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const message = entry.message ?? {};
    if (message.model === "<synthetic>") continue;
    const usage = normalizeUsage(message.usage);
    if (!usage) continue;
    const key = message.id ?? entry.uuid;
    if (typeof key !== "string") continue;

    out.push([
      timestamp(entry.timestamp),
      // Claude Code sends everything to one endpoint, so its bills belong to
      // that supplier even though the tool name is not the provider.
      channels.claude,
      baseModel(String(message.model || "unknown")),
      usage.input,
      usage.output,
      usage.cacheRead,
      usage.cacheWrite,
      key,
    ]);
  }
  return out;
}

export type ScanProgress = {
  readonly done: number;
  readonly total: number;
};

/** Cache rows for one file, keyed by size+mtime so a growing log is re-read. */
type FileEntry = {
  mtime: number;
  size: number;
  rows: PackedRecord[];
};

export type CacheFile = {
  version: number;
  files: Record<string, FileEntry | null>;
};

const CACHE_VERSION = 4;
/** Bounded parallelism: 777 files open at once is more than macOS likes. */
const CONCURRENCY = 8;

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".jsonl")) out.push(full);
    }
  };
  await walk(root);
  return prefix ? out.filter((file) => path.basename(file).startsWith(prefix)) : out;
}

export type ScanResult = {
  readonly records: readonly RequestRecord[];
  /** Files read this pass; zero means the cache answered everything. */
  readonly read: number;
  readonly total: number;
};

/**
 * Reads every transcript, reusing parsed rows for files whose size and mtime
 * are unchanged. A warm pass only stats files, which is why refreshes are cheap
 * enough to run on a timer.
 */
export async function scan(options: {
  cache: CacheFile;
  channels: Channels;
  onProgress?: (progress: ScanProgress) => void;
}): Promise<{ result: ScanResult; cache: CacheFile }> {
  const { stat } = await import("node:fs/promises");
  const sources: Array<{ root: string; parse: (text: string) => PackedRecord[]; source: RequestRecord["source"] }> = [
    { root: QODER_ROOT, parse: (text) => parseQoderFile(text, options.channels), source: "qoder" },
    { root: CODEX_ROOT, parse: (text) => parseCodexFile(text, options.channels), source: "codex" },
    { root: CLAUDE_ROOT, parse: (text) => parseClaudeFile(text, options.channels), source: "claude" },
  ];

  const files: Array<{ path: string; source: RequestRecord["source"]; parse: (text: string) => PackedRecord[] }> = [];
  for (const source of sources) {
    for (const file of await listFiles(source.root)) {
      files.push({ path: file, source: source.source, parse: source.parse });
    }
  }

  const cache: CacheFile = { version: CACHE_VERSION, files: { ...options.cache.files } };
  const next: Record<string, FileEntry | null> = {};
  let done = 0;
  let read = 0;

  const records = await pool(files, CONCURRENCY, async (file) => {
    const cached = cache.files[file.path];
    const rows: PackedRecord[] = [];

    try {
      const info = await stat(file.path);
      if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) {
        next[file.path] = cached;
        for (const row of cached.rows) {
          rows.push(row);
        }
        return { rows, source: file.source } as const;
      }

      const text = await readFile(file.path, "utf8");
      read += 1;
      const parsed = file.parse(text);
      next[file.path] = { mtime: info.mtimeMs, size: info.size, rows: parsed };
      return { rows: parsed, source: file.source } as const;
    } catch {
      next[file.path] = null;
      return { rows, source: file.source } as const;
    } finally {
      done += 1;
      if (done % 40 === 0 || done === files.length) {
        options.onProgress?.({ done, total: files.length });
      }
    }
  });

  const unpacked: RequestRecord[] = [];
  for (const group of records) {
    for (const row of group.rows) unpacked.push(unpack(row, group.source));
  }

  return {
    result: { records: unpacked, read, total: files.length },
    cache: { version: CACHE_VERSION, files: next },
  };
}

export async function readCache(): Promise<CacheFile> {
  const raw = (await readJSON(path.join(CACHE_DIR, "index.json"))) as CacheFile | undefined;
  if (!raw || raw.version !== CACHE_VERSION) return { version: CACHE_VERSION, files: {} };
  return raw;
}

export async function writeCache(cache: CacheFile) {
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const target = path.join(CACHE_DIR, "index.json");
    const temporary = `${target}.${process.pid}.tmp`;
    // A write this large is worth making atomic, so a crash mid-save cannot
    // leave a truncated index that the next start would have to discard.
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, target);
  } catch {
    // A cache that cannot be written only costs a rescan next time.
  }
}

/** Canonical display name: prefer the pricing table's spelling so variants merge. */
export function canonicalModel(pricing: Pricing, model: string) {
  const table = new Map<string, string>();
  for (const name of Object.keys(pricing.models)) table.set(normalizeModel(name), name);
  return table.get(normalizeModel(model)) ?? model;
}
