import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const name = "opencode-sidebar-enhanced", dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });
const stage = await fs.mkdtemp(path.join(dist, "build-"));
const bundle = path.join(stage, name);
await fs.mkdir(bundle);
// Explicit allowlist: no sessions, settings, logs, caches, node_modules or local credentials.
const modules = {
  "opencode-project-sessions": ["tui.tsx", "sessions.ts", "status.ts", "theme.ts", "board.ts", "board.tsx", "board-filters.tsx", "archive-dialog.tsx", "calendar.ts", "project-view.ts", "sidebar-card.tsx", "sidebar-color.ts", "sidebar-todo.tsx", "todos.ts"],
  "opencode-project-tabs": ["tui.tsx", "sidebar-card.tsx", "sidebar-color.ts", "LICENSE"],
  "opencode-quota": ["tui.tsx", "sidebar-card.tsx", "sidebar-color.ts", "src/prices.ts", "src/scan.ts", "src/state.ts", "src/table.ts", "src/usage.ts"],
  "opencode-context-bar": ["tui.tsx"],
};
for (const [module, files] of Object.entries(modules)) {
  const source = path.join(root, "plugins", module), target = path.join(bundle, "plugins", module);
  for (const file of ["package.json", ...files]) {
    const content = await fs.readFile(path.join(source, file));
    if (/\/Users\/[^/]+\//.test(content.toString())) throw new Error(`Machine-specific home path in ${module}/${file}`);
    await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await fs.writeFile(path.join(target, file), content);
  }
}
for (const file of ["install.sh", "Install.command", "Uninstall.command", "install.mjs", "installer-lib.mjs", "README.md", "README.zh-CN.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await fs.copyFile(path.join(root, file), path.join(bundle, file));
  if (/\.sh$|\.command$/.test(file)) await fs.chmod(path.join(bundle, file), 0o755);
}
const screenshot = path.join(root, "docs", "images", "screenshot.png");
try {
  await fs.access(screenshot);
  await fs.mkdir(path.join(bundle, "docs", "images"), { recursive: true });
  await fs.copyFile(screenshot, path.join(bundle, "docs", "images", "screenshot.png"));
} catch (error) { if (error.code !== "ENOENT") throw error; }
const files = {};
async function hashTree(directory, prefix = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name), file = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashTree(file, relative);
    else files[relative] = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
  }
}
await hashTree(bundle);
await fs.writeFile(path.join(bundle, "manifest.json"), `${JSON.stringify({ version, builtAt: new Date().toISOString(), files }, null, 2)}\n`);
for (const [command, args, extension] of [
  ["tar", ["-czf", path.join(stage, "bundle.tar.gz"), "-C", stage, name], "tar.gz"],
  ["zip", ["-qr", path.join(stage, "bundle.zip"), name], "zip"],
]) {
  const result = spawnSync(command, args, { cwd: stage, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed`);
  await fs.rename(path.join(stage, `bundle.${extension}`), path.join(dist, `${name}-v${version}.${extension}`));
}
const artifacts = [`${name}-v${version}.tar.gz`, `${name}-v${version}.zip`];
const sums = await Promise.all(artifacts.map(async (file) => `${crypto.createHash("sha256").update(await fs.readFile(path.join(dist, file))).digest("hex")}  ${file}`));
await fs.writeFile(path.join(dist, "SHA256SUMS"), `${sums.join("\n")}\n`);
const relative = path.relative(dist, bundle);
await fs.writeFile(path.join(dist, "install.sh"), `#!/usr/bin/env bash\nset -euo pipefail\nHERE="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"\nexec bash "$HERE/${relative}/install.sh" "$@"\n`, { mode: 0o755 });
console.log(`Built ${artifacts.join(" and ")}\nInstall locally: bash dist/install.sh`);
