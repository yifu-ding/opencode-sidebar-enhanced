/** Theme background with unchanged hue/saturation and slightly lower lightness. */
export function deepenBackground(base: { r: number; g: number; b: number }): string {
  const { r, g, b } = base;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2, delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const next = Math.max(0, lightness - (lightness > 0.5 ? 0.065 : 0.045));
  const chroma = (1 - Math.abs(2 * next - 1)) * saturation;
  const middle = next - chroma / 2;
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, delta === 0 ? next : middle + ((value - min) / delta) * chroma)) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
