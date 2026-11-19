import path from "node:path";

export const MODULES = ["opencode-context-bar", "opencode-project-tabs", "opencode-project-sessions", "opencode-quota"];
export const DISABLED = ["-opencode.sidebar.context", "-opencode.sidebar.footer", "-opencode.sidebar.todo"];

/** JSONC without evaluating JavaScript or misreading // inside quoted URLs. */
export function parseConfig(text) {
  let clean = "", string = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (string) {
      clean += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') string = false;
    } else if (c === '"') { string = true; clean += c; }
    else if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; clean += "\n"; }
    else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated config comment");
      clean += " "; i = end + 1;
    } else clean += c;
  }
  let output = ""; string = false; escaped = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (!string && c === "," && /^\s*[}\]]/.test(clean.slice(i + 1))) continue;
    output += c;
    if (escaped) escaped = false;
    else if (string && c === "\\") escaped = true;
    else if (c === '"') string = !string;
  }
  const config = JSON.parse(output.replace(/^\uFEFF/, ""));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("CLI config must be an object");
  if (config.plugins !== undefined && (!Array.isArray(config.plugins) || config.plugins.some((p) => typeof p !== "string"))) {
    throw new Error("Unsupported plugins format; no files were changed");
  }
  return config;
}

function knownPlugin(value) {
  if (value.startsWith("-")) return false;
  const input = value.replace(/^file:\/\//, "").replace(/\/$/, "");
  const base = path.basename(input);
  return MODULES.includes(base) || MODULES.some((name) => input === `${name}/tui` || input.includes(`/${name}/`) && /\/tui\.(tsx?|jsx?)$/.test(input));
}

export function installConfig(config, installedPaths, previous = {}) {
  const plugins = config.plugins ?? [];
  const displaced = plugins.filter((p) => knownPlugin(p) && !(previous.installedPaths ?? []).includes(p));
  const kept = plugins.filter((p) => !knownPlugin(p) && !(previous.installedPaths ?? []).includes(p));
  const introducedDisabled = [...new Set([...(previous.introducedDisabled ?? []), ...DISABLED.filter((p) => !plugins.includes(p))])];
  return {
    config: { ...config, $schema: config.$schema ?? "https://opencode.ai/v2/cli.json", plugins: [...new Set([...kept, ...installedPaths, ...DISABLED])] },
    record: { installedPaths, introducedDisabled, displaced: [...new Set([...(previous.displaced ?? []), ...displaced])] },
  };
}

export function uninstallConfig(config, record) {
  const plugins = (config.plugins ?? []).filter((p) => !record.installedPaths.includes(p) && !record.introducedDisabled.includes(p));
  return { ...config, plugins: [...new Set([...plugins, ...record.displaced])] };
}
