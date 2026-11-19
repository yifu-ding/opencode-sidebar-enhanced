const GAP = " ";

/** Display cells one character occupies; CJK provider names take two. */
function glyphWidth(char: string) {
  return char.charCodeAt(0) > 0x2e7f ? 2 : 1;
}

export function width(text: string) {
  let total = 0;
  for (const char of text) total += glyphWidth(char);
  return total;
}

function cell(text: string, size: number, align: "left" | "right") {
  if (size <= 0) return "";
  if (width(text) > size) {
    let out = "";
    let used = 0;
    for (const char of text) {
      const cells = glyphWidth(char);
      if (used + cells > size - 1) break;
      out += char;
      used += cells;
    }
    text = `${out}…`;
  }
  const gap = " ".repeat(Math.max(0, size - width(text)));
  return align === "left" ? `${text}${gap}` : `${gap}${text}`;
}

type Cells = {
  name: string;
  cost: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  hit: string;
  unit: string;
};

type Column = {
  readonly key: keyof Cells;
  readonly header: string;
  readonly size: number;
  readonly align: "left" | "right";
  readonly min: number;
};

const TABLE: readonly Column[] = [
  { key: "name", header: "provider · model", size: 0, align: "left", min: 14 },
  { key: "cost", header: "spend", size: 12, align: "right", min: 0 },
  { key: "input", header: "input", size: 10, align: "right", min: 0 },
  { key: "output", header: "output", size: 10, align: "right", min: 0 },
  { key: "cacheRead", header: "cache R", size: 10, align: "right", min: 0 },
  { key: "cacheWrite", header: "cache W", size: 10, align: "right", min: 0 },
  { key: "hit", header: "hit", size: 8, align: "right", min: 0 },
  { key: "unit", header: "$/M in / out / cR / cW", size: 24, align: "left", min: 0 },
];

const OPTIONAL: readonly (keyof Cells)[] = ["unit", "cacheWrite", "hit", "cacheRead"];

type Layout = {
  readonly columns: readonly Column[];
  readonly widths: Partial<Record<keyof Cells, number>>;
};

/** Keep money columns first, then give the name the remaining display cells. */
export function layout(available: number): Layout {
  available = Math.max(0, Math.floor(available));
  let columns = TABLE;
  while (columns.length) {
    const fixed = columns.reduce((sum, column) => sum + (column.key === "name" ? column.min : column.size), 0);
    const spare = available - fixed - (columns.length - 1) * GAP.length;
    if (spare >= 0) {
      const widths: Layout["widths"] = {};
      for (const column of columns) {
        widths[column.key] = column.key === "name" ? Math.min(34, spare + column.min) : column.size;
      }
      return { columns, widths };
    }
    const drop = OPTIONAL.find((key) => columns.some((column) => column.key === key));
    if (!drop) break;
    columns = columns.filter((column) => column.key !== drop);
  }
  // Very small panels still retain spend before token-class details.
  columns = TABLE.filter((column) => column.key === "name" || column.key === "cost");
  if (available < 14) columns = TABLE.filter((column) => column.key === "cost");
  return {
    columns,
    widths: columns.length === 1
      ? { cost: available }
      : { name: available - 13, cost: 12 },
  };
}

export function line(cells: Cells, plan: Layout) {
  return plan.columns
    .map((column) => cell(cells[column.key], plan.widths[column.key] ?? 0, column.align))
    .join(GAP);
}

export function header(plan: Layout) {
  return plan.columns
    .map((column) => cell(column.header, plan.widths[column.key] ?? 0, column.align))
    .join(GAP);
}
