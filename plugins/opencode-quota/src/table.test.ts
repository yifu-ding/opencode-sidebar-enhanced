import { test } from "node:test";
import assert from "node:assert/strict";
import { header, layout, line, width } from "./table.ts";

const cells = {
  name: "  很长的供应商名称/claude-opus-model-with-a-long-suffix",
  cost: "$123,456.78",
  input: "$1,234.56",
  output: "$9,876.54",
  cacheRead: "$123.45",
  cacheWrite: "$678.90",
  hit: "99.9%",
  unit: "4 / 20 / 0.2 / 5",
};

test("headers and rows fit every terminal width from 70 to 200", () => {
  for (let terminal = 70; terminal <= 200; terminal++) {
    const available = terminal - 4;
    const plan = layout(available);
    assert.ok(width(header(plan)) <= available, `header at ${terminal}`);
    assert.ok(width(line(cells, plan)) <= available, `row at ${terminal}`);
    assert.equal(width(line(cells, plan)), width(header(plan)));
    let offset = 0;
    for (const column of plan.columns) {
      const size = plan.widths[column.key]!;
      if (column.key !== "name") {
        const start = width(line(cells, plan).split(cells[column.key])[0]!);
        const expected = offset + (column.align === "right" ? size - width(cells[column.key]) : 0);
        assert.equal(start, expected, `${column.key} alignment at ${terminal}`);
      }
      offset += size + 1;
    }
  }
});

test("70 columns retain spend, input, and output; 160 show all details", () => {
  const narrow = layout(66).columns.map((column) => column.key);
  for (const key of ["name", "cost", "input", "output"] as const) assert.ok(narrow.includes(key));
  assert.ok(!narrow.includes("unit"));
  assert.equal(layout(156).columns.length, 8);
});

test("tiny widths have defined columns and do not overflow", () => {
  for (let available = 0; available < 66; available++) {
    const plan = layout(available);
    assert.ok(plan.columns.every((column) => plan.widths[column.key] !== undefined));
    assert.ok(width(header(plan)) <= available, `header at ${available}`);
    assert.ok(width(line(cells, plan)) <= available, `row at ${available}`);
  }
});
