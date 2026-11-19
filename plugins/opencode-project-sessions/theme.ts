import type { Context } from "@opencode/plugin/tui/context";
import type { StatusTone } from "./status.ts";

/** Brand gold for the "Important" status; the theme has no gold token. */
export const GOLD = "#e8b84b";

/**
 * Maps a status tone onto a theme colour.
 *
 * Kept as a function of the live theme so a theme switch repaints status glyphs
 * without any status data changing. `gold` is the one tone the theme cannot
 * express, so it falls back to a literal.
 */
export function toneColor(context: Context, tone: StatusTone) {
  const feedback = context.theme.text.feedback;
  switch (tone) {
    case "info":
      return feedback.info.base;
    case "warning":
      return feedback.warning.base;
    case "success":
      return feedback.success.base;
    case "error":
      return feedback.error.base;
    case "gold":
      return GOLD;
    case "paused":
      return context.themeMode === "light" ? "#666666" : "#b5b5b5";
    case "active":
      return context.themeMode === "light" ? "#1677ff" : "#5aa2ff";
    default:
      return context.theme.text.muted;
  }
}
