import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { MODULES, installConfig, uninstallConfig, parseConfig } from "./installer-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} requires a path`); return path.resolve(args[i + 1]); };
const configFile = option("--config", path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "cli.json"));
const destination = option("--destination", path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode-sidebar-enhanced"));
const recordFile = path.join(destination, "install-record.json");
const readOptional = async (file) => { try { return await fs.readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } };
const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.sidebar-suite-${process.pid}.tmp`;
  try { await fs.writeFile(temp, text, { mode: 0o600, flag: "wx" }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}

async function main() {
  for (let index = 0; index < args.length; index++) {
    if (["--config", "--destination"].includes(args[index])) { index++; continue; }
    if (!["--help", "--dry-run", "--uninstall"].includes(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (flag("--help")) {
    console.log("Usage: bash install.sh [--dry-run] [--uninstall] [--config PATH] [--destination PATH]"); return;
  }
  const original = await readOptional(configFile);
  const config = original === undefined ? {} : parseConfig(original);
  const recordText = await readOptional(recordFile);
  const previous = recordText ? JSON.parse(recordText) : undefined;
  if (flag("--uninstall") && !previous) { console.log("No suite installation record found. Nothing changed."); return; }
  let merged, record, release;
  if (flag("--uninstall")) merged = uninstallConfig(config, previous);
  else {
    const version = spawnSync("opencode", ["--version"], { encoding: "utf8" });
    const match = version.stdout?.match(/(\d+)\.(\d+)\.(\d+)/);
    if (match && (Number(match[1]) < 2 || Number(match[1]) === 2 && (Number(match[2]) < 2 || Number(match[2]) === 2 && Number(match[3]) < 5))) {
      throw new Error("This suite requires OpenCode V2 2.2.5+; upgrade OpenCode first.");
    }
    if (!match) console.log("Note: OpenCode was not found on PATH. Install OpenCode V2 2.2.5+ before using these plugins.");
    const manifest = JSON.parse(await fs.readFile(path.join(here, "manifest.json"), "utf8"));
    for (const [relative, expected] of Object.entries(manifest.files)) {
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Unsafe package manifest path");
      const content = await fs.readFile(path.join(here, relative));
      if (crypto.createHash("sha256").update(content).digest("hex") !== expected) throw new Error(`Package checksum mismatch: ${relative}`);
    }
    for (const name of MODULES) await fs.access(path.join(here, "plugins", name, "tui.tsx"));
    release = path.join(destination, "releases", `${manifest.version}-${stamp}`);
    const next = installConfig(config, MODULES.map((name) => path.join(release, "plugins", name)), previous);
    merged = next.config; record = { ...next.record, version: manifest.version, installedAt: new Date().toISOString(), configFile, release };
  }
  console.log(`${flag("--uninstall") ? "Uninstall" : "Install"}${flag("--dry-run") ? " (dry run)" : ""}`);
  console.log(`CLI config: ${configFile}\nPlugin files: ${destination}`);
  if (flag("--dry-run")) { console.log("No files changed."); return; }
  if (previous && previous.configFile !== configFile) throw new Error("Installation record belongs to another CLI config. Use its --config path or a separate --destination.");
  if (release) {
    await fs.mkdir(path.dirname(release), { recursive: true });
    await fs.mkdir(release); // A unique new release; never overwrite an existing plugin tree.
    await fs.cp(path.join(here, "plugins"), path.join(release, "plugins"), { recursive: true, force: false, errorOnExist: true });
  }
  if (await readOptional(configFile) !== original) throw new Error("CLI config changed during installation; not overwriting it. Run the installer again.");
  if (original !== undefined) {
    const backup = `${configFile}.sidebar-suite-backup-${stamp}`;
    await fs.copyFile(configFile, backup, fs.constants.COPYFILE_EXCL);
    console.log(`Config backup: ${backup}`);
  }
  await atomicWrite(configFile, `${JSON.stringify(merged, null, 2)}\n`);
  if (flag("--uninstall")) {
    await fs.rename(recordFile, `${recordFile}.uninstalled-${stamp}`);
    console.log("Suite disabled. Plugin files and all session/status/archive data were kept.");
  } else {
    await atomicWrite(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    console.log("Installed Tabs, Projects, Todo, Status, Board, Usage and Context meter.");
  }
  console.log("In OpenCode, run /reload. No service restart is needed.");
}
main().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
