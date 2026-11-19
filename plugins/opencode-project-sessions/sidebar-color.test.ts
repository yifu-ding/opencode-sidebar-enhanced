import { test } from "node:test";
import assert from "node:assert/strict";
import { deepenBackground } from "./sidebar-color.ts";

function rgb(hex: string) { return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255); }
test("purple cards deepen without adding a complementary yellow tint", () => {
  const [r, g, b] = rgb(deepenBackground({ r: 0.95, g: 0.90, b: 0.98 }));
  assert.ok(b! > r! && r! > g!);
  assert.ok(r! < .95 && g! < .9 && b! < .98);
  const originalRatio = (.95 - .9) / (.98 - .9);
  assert.ok(Math.abs((r! - g!) / (b! - g!) - originalRatio) < .03);
});
test("neutral, black and white backgrounds stay neutral and finite", () => {
  for (const value of [0, .15, .5, 1]) {
    const hex = deepenBackground({ r: value, g: value, b: value });
    assert.match(hex, /^#[0-9a-f]{6}$/);
    const [r, g, b] = rgb(hex);
    assert.equal(r, g); assert.equal(g, b);
  }
});
