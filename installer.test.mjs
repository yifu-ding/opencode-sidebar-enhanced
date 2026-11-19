import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODULES, DISABLED, parseConfig, installConfig, uninstallConfig } from "./installer-lib.mjs";

test("JSONC parses comments, trailing commas, URLs and escaped strings without eval", () => {
  assert.deepEqual(parseConfig('{ // comment\n "url": "https://example.com/a//b", /* hello */ "plugins": ["safe",], "text": "a\\\"b", }'),
    { url: "https://example.com/a//b", plugins: ["safe"], text: 'a"b' });
  assert.throws(() => parseConfig('{"plugins": "not-array"}'));
  assert.throws(() => parseConfig('{"key": /* broken }'));
});
test("installation keeps unrelated settings and plugins, avoids duplicate modules", () => {
  const source = { theme: { name: "purple" }, keybinds: { leader: "ctrl+x" }, plugins: ["another-plugin", "-opencode.sidebar.todo", "/custom/opencode-project-sessions", "/custom/opencode-project-tabs/tui.tsx"] };
  const paths = MODULES.map((name) => `/install/release1/plugins/${name}`);
  const { config, record } = installConfig(source, paths);
  assert.deepEqual(config.theme, source.theme);
  assert.deepEqual(config.keybinds, source.keybinds);
  assert.ok(config.plugins.includes("another-plugin"));
  assert.ok(!config.plugins.includes("/custom/opencode-project-sessions"));
  assert.ok(!record.introducedDisabled.includes("-opencode.sidebar.todo"));
  assert.equal(config.plugins.length, 1 + 4 + 3);
  assert.equal(source.plugins.length, 4);
});
test("upgrade replaces previous paths; uninstall preserves later settings and prior disables", () => {
  const source = { plugins: ["other", "-opencode.sidebar.todo", "/old/opencode-project-tabs"] };
  const first = installConfig(source, MODULES.map((name) => `/v1/plugins/${name}`));
  const next = installConfig({ ...first.config, newSetting: true, plugins: [...first.config.plugins, "added-later"] }, MODULES.map((name) => `/v2/plugins/${name}`), first.record);
  assert.ok(!next.config.plugins.some((p) => p.startsWith("/v1/")));
  const restored = uninstallConfig(next.config, next.record);
  assert.ok(restored.newSetting);
  assert.deepEqual(restored.plugins, ["other", "-opencode.sidebar.todo", "added-later", "/old/opencode-project-tabs"]);
});

test("built installer installs, upgrades, backs up, uninstalls and dry-runs in an isolated home", async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.join(root, "dist");
  const builds = (await fs.readdir(dist)).filter((name) => name.startsWith("build-"));
  const buildsWithStats = await Promise.all(builds.map(async (name) => ({ name, time: (await fs.stat(path.join(dist, name))).mtimeMs })));
  const latest = buildsWithStats.sort((a, b) => b.time - a.time)[0];
  assert.ok(latest, "Run npm run build before this integration test");
  const bundle = path.join(dist, latest.name, "opencode-sidebar-enhanced");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar-installer-test-"));
  const configFile = path.join(temp, "config", "opencode", "cli.json");
  const destination = path.join(temp, "data", "suite");
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  const original = '{\n // preserve this in backup\n "theme": {"name":"purple"}, "plugins": ["other", "-opencode.sidebar.todo",],\n "tabs":{"scope":"cwd"}\n}\n';
  await fs.writeFile(configFile, original);
  const run = (...args) => spawnSync(process.execPath, [path.join(bundle, "install.mjs"), "--config", configFile, "--destination", destination, ...args], { encoding: "utf8", env: { ...process.env, HOME: temp } });
  let result = run("--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(configFile, "utf8"), original);
  await assert.rejects(fs.access(destination));
  result = run(); assert.equal(result.status, 0, result.stderr);
  let config = JSON.parse(await fs.readFile(configFile, "utf8"));
  assert.equal(config.theme.name, "purple"); assert.equal(config.tabs.scope, "cwd");
  assert.equal(config.plugins.length, 8);
  const record = JSON.parse(await fs.readFile(path.join(destination, "install-record.json"), "utf8"));
  for (const name of MODULES) await fs.access(path.join(record.release, "plugins", name, "tui.tsx"));
  const backup = (await fs.readdir(path.dirname(configFile))).find((file) => file.includes("sidebar-suite-backup"));
  assert.equal(await fs.readFile(path.join(path.dirname(configFile), backup), "utf8"), original);
  result = run(); assert.equal(result.status, 0, result.stderr);
  config = JSON.parse(await fs.readFile(configFile, "utf8")); assert.equal(config.plugins.length, 8);
  config.extra = "later"; config.plugins.push("later-plugin"); await fs.writeFile(configFile, JSON.stringify(config));
  result = run("--uninstall"); assert.equal(result.status, 0, result.stderr);
  config = JSON.parse(await fs.readFile(configFile, "utf8"));
  assert.deepEqual(config.plugins, ["other", "-opencode.sidebar.todo", "later-plugin"]);
  assert.equal(config.extra, "later");
  await fs.access(record.release); // Uninstall keeps code and all data.
});

test("invalid config and tampered payload fail before config changes", async () => {
  const root = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(root, "dist");
  const builds = (await fs.readdir(dist)).filter((name) => name.startsWith("build-"));
  const bundle = path.join(dist, builds[0], "opencode-sidebar-enhanced");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar-invalid-test-"));
  const configFile = path.join(temp, "cli.json"), destination = path.join(temp, "suite");
  await fs.writeFile(configFile, "{ broken");
  let result = spawnSync(process.execPath, [path.join(bundle, "install.mjs"), "--config", configFile, "--destination", destination], { encoding: "utf8" });
  assert.notEqual(result.status, 0); assert.equal(await fs.readFile(configFile, "utf8"), "{ broken");
  const copied = path.join(temp, "bundle"); await fs.cp(bundle, copied, { recursive: true });
  await fs.appendFile(path.join(copied, "plugins", "opencode-project-sessions", "tui.tsx"), "\n// changed");
  await fs.writeFile(configFile, "{}");
  result = spawnSync(process.execPath, [path.join(copied, "install.mjs"), "--config", configFile, "--destination", destination], { encoding: "utf8" });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /checksum mismatch/);
  assert.equal(await fs.readFile(configFile, "utf8"), "{}");
});
