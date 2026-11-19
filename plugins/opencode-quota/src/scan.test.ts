import { test } from "node:test";
import assert from "node:assert/strict";

import type { Channels } from "./scan.ts";
import { parseClaudeFile, parseCodexFile, parseQoderFile, pack, unpack, providerLabel } from "./scan.ts";

const channels: Channels = {
  qoderById: new Map([["qoder-custom-1ae5767b-1111-2222-3333-444455556666", "ZenMux"]]),
  qoderByModel: new Map([["gpt-6.1-sol", "cch"]]),
  codexByName: new Map([["cch", "cch"], ["openai_http", "OpenAI"]]),
  claude: "ZenMux",
};

function jsonl(...entries: unknown[]) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

test("provider labels use real names instead of a generic official label", () => {
  assert.equal(providerLabel("https://api.openai.com/v1"), "OpenAI");
  assert.equal(providerLabel("https://chatgpt.com/backend-api/codex"), "OpenAI");
  assert.equal(providerLabel("https://api.anthropic.com"), "Anthropic");
  assert.equal(providerLabel(undefined, "Anthropic"), "Anthropic");
  assert.equal(providerLabel("https://generativelanguage.googleapis.com/v1beta"), "Google");
  assert.equal(providerLabel("https://api.deepseek.com/v1"), "DeepSeek");
  assert.equal(providerLabel("https://openrouter.ai/api/v1"), "OpenRouter");
  assert.equal(providerLabel("https://my-resource.openai.azure.com"), "Azure OpenAI");
  assert.equal(providerLabel("https://private-proxy.example/v1"), "private-proxy.example");
  assert.equal(providerLabel(undefined, "My Provider"), "My Provider");
});

test("qoder keeps one row per billed turn", () => {
  const text = jsonl(
    { type: "runtime-config", model: "qoder-custom-31d1efd0-1111-2222-3333-444455556666/gpt-6.1-sol" },
    {
      type: "assistant",
      timestamp: "2026-11-15T10:00:00.000Z",
      message: {
        id: "msg_1",
        model: "qoder-custom-31d1efd0-1111-2222-3333-444455556666/gpt-6.1-sol",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 5,
        },
      },
    },
  );

  const rows = parseQoderFile(text, channels);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.slice(1, 4), ["cch", "gpt-6.1-sol", 100]);
  assert.equal(rows[0]![5], 900);
  assert.equal(rows[0]![6], 5);
});

test("qoder drops router attempts that carry no usage", () => {
  const text = jsonl(
    { type: "assistant", message: { id: "msg_auto", model: "auto", usage: {} } },
    {
      type: "assistant",
      message: {
        id: "msg_real",
        model: "qoder-custom-1ae5767b-1111-2222-3333-444455556666/claude-opus-5-5",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
  );
  const rows = parseQoderFile(text, channels);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]![1], "ZenMux");
});

test("qoder drops the synthetic turn and duplicate message ids", () => {
  const line = {
    type: "assistant",
    message: {
      id: "msg_dup",
      model: "qoder-custom-1ae5767b-1111-2222-3333-444455556666/claude-opus-5-5",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
  const rows = parseQoderFile(
    jsonl(line, line, { type: "assistant", message: { id: "msg_s", model: "<synthetic>" } }),
    channels,
  );
  assert.equal(rows.length, 1);
});

test("qoder falls back to the model->channel map", () => {
  const rows = parseQoderFile(
    jsonl({
      type: "assistant",
      message: { id: "m", model: "gpt-6-astra", usage: { input_tokens: 1, output_tokens: 1 } },
    }),
    { ...channels, qoderByModel: new Map([["gpt-6-astra", "OpenAI"]]) },
  );
  assert.equal(rows[0]![1], "OpenAI");
});

test("codex subtracts cached tokens from its running input count", () => {
  const text = jsonl(
    { type: "session_meta", payload: { id: "s1", model_provider: "cch" } },
    { type: "turn_context", payload: { model: "gpt-6.2-sol" } },
    {
      type: "event_msg",
      timestamp: "2026-11-15T10:00:00.000Z",
      ordinal: 7,
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 800,
            cache_write_input_tokens: 50,
            output_tokens: 30,
          },
        },
      },
    },
  );

  const rows = parseCodexFile(text, channels);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.slice(1, 7), ["cch", "gpt-6.2-sol", 150, 30, 800, 50]);
});

test("codex ignores a token_count without usage", () => {
  const rows = parseCodexFile(
    jsonl({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: {} } } }),
    channels,
  );
  assert.equal(rows.length, 0);
});

test("claude rows take the configured endpoint as their provider", () => {
  const rows = parseClaudeFile(
    jsonl({
      type: "assistant",
      timestamp: "2026-11-15T10:00:00.000Z",
      message: {
        id: "msg_x",
        model: "anthropic/claude-opus-5.5",
        usage: {
          input_tokens: 5,
          output_tokens: 6,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 8,
        },
      },
    }),
    channels,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.slice(1, 7), ["ZenMux", "claude-opus-5.5", 5, 6, 7, 8]);
});

test("a packed record round-trips and gains its source in the key", () => {
  const packed = pack({
    key: "abc",
    ts: 5,
    provider: "cch",
    model: "gpt-6-astra",
    source: "qoder",
    usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
  });
  const back = unpack(packed, "qoder");
  assert.equal(back.key, "qoder:abc");
  assert.equal(back.provider, "cch");
  assert.deepEqual(back.usage, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
});
