import assert from "node:assert/strict";
import { test } from "node:test";
import { rasterizeEdges } from "../extensions/task-dag/graph-paint.ts";
import type {
  GraphLayout,
  Point,
  RoutedEdge,
} from "../extensions/task-dag/graph-layout.ts";

function edge(from: string, to: string, path: Point[]): RoutedEdge {
  const start = path[0];
  const end = path.at(-1);
  assert.ok(start);
  assert.ok(end);
  return { from, to, start, end, path };
}
function drawing(edges: RoutedEdge[]): GraphLayout {
  return { mode: "graph", width: 5, height: 5, nodes: [], edges };
}
const horizontal = Array.from({ length: 5 }, (_, x) => ({ x, y: 2 }));
const vertical = Array.from({ length: 5 }, (_, y) => ({ x: 2, y }));

test("unrelated crossing is marked ╳, never a junction", () => {
  const raster = rasterizeEdges(
    drawing([edge("A", "B", horizontal), edge("C", "D", vertical)]),
  );
  assert.equal(raster.ambiguous, false);
  assert.equal(raster.crossings, true);
  assert.equal(
    raster.cells.find((cell) => cell.x === 2 && cell.y === 2)?.glyph,
    "╳",
  );
});
test("unrelated shared trunks are rejected as ambiguous rather than inventing dependencies", () => {
  const raster = rasterizeEdges(
    drawing([
      edge("A", "B", horizontal),
      edge("C", "D", horizontal.slice(1, 4)),
    ]),
  );
  assert.equal(raster.ambiguous, true);
});
test("a genuine shared-source fork keeps its junction", () => {
  const fork = [...horizontal.slice(0, 3), { x: 2, y: 3 }, { x: 2, y: 4 }];
  const raster = rasterizeEdges(
    drawing([edge("A", "B", horizontal), edge("A", "C", fork)]),
  );
  assert.equal(raster.ambiguous, false);
  assert.equal(raster.crossings, false);
  assert.equal(
    raster.cells.find((cell) => cell.x === 2 && cell.y === 2)?.glyph,
    "┬",
  );
});
test("disconnected or diagonal routes fail at the renderer boundary", () => {
  const diagonal = edge("A", "B", [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  assert.throws(() => rasterizeEdges(drawing([diagonal])), /orthogonal route/);
  assert.throws(
    () => rasterizeEdges(drawing([{ ...diagonal, path: [] }])),
    /connect its ports/,
  );
});
