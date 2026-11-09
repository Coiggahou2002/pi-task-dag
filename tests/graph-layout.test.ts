import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGraphLayout,
  inside,
  pointKey,
} from "../extensions/task-dag/graph-layout.ts";
import { rasterizeEdges } from "../extensions/task-dag/graph-paint.ts";
import {
  demoState,
  emptyState,
  plan,
  update,
  type InputNode,
} from "../extensions/task-dag/state.ts";

test("fork/join is a real routed DAG with one direction per dependency and no lines through nodes", () => {
  const state = demoState();
  const graph = state.graph;
  assert.ok(graph);
  const layout = buildGraphLayout(graph, 36);
  assert.equal(layout.mode, "graph");
  assert.equal(layout.width, 36);
  assert.deepEqual(
    layout.edges.map((edge) => `${edge.from}->${edge.to}`).sort(),
    ["A->B", "A->C", "B->D", "C->D", "D->E"],
  );
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(nodes.get("B")?.y, nodes.get("C")?.y);
  assert.notEqual(nodes.get("B")?.x, nodes.get("C")?.x);
  for (const edge of layout.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    assert.ok(from);
    assert.ok(to);
    assert.equal(edge.start.y, from.y + from.height);
    assert.equal(edge.end.y, to.y - 1);
    assert.ok(edge.start.y <= edge.end.y);
    assert.deepEqual(edge.path[0], edge.start);
    assert.deepEqual(edge.path.at(-1), edge.end);
    assert.equal(new Set(edge.path.map(pointKey)).size, edge.path.length);
    for (const point of edge.path)
      assert.ok(layout.nodes.every((box) => !inside(point, box)));
    for (let index = 1; index < edge.path.length; index++) {
      const a = edge.path[index - 1];
      const b = edge.path[index];
      assert.ok(a);
      assert.ok(b);
      assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1);
    }
  }
  const raster = rasterizeEdges(layout);
  assert.equal(raster.ambiguous, false);
  assert.equal(raster.crossings, false);
  assert.equal(raster.cells.filter((cell) => cell.glyph === "▼").length, 5);
});

test("completion changes do not move nodes or reroute the topology", () => {
  const before = demoState();
  assert.ok(before.graph);
  const after = update(before, before.revision, "B", "complete", "tests");
  assert.ok(after.graph);
  assert.deepEqual(
    buildGraphLayout(before.graph, 36),
    buildGraphLayout(after.graph, 36),
  );
});

test("long edges and disconnected components remain obstacle-safe", () => {
  const nodes: InputNode[] = [
    { id: "A", title: "A", dependsOn: [] },
    { id: "B", title: "B", dependsOn: ["A"] },
    { id: "C", title: "C", dependsOn: ["B"] },
    { id: "D", title: "D", dependsOn: ["A", "C"] },
    { id: "X", title: "X", dependsOn: [] },
    { id: "Y", title: "Y", dependsOn: ["X"] },
  ];
  const state = plan(emptyState(), 0, "long edges", nodes);
  assert.ok(state.graph);
  const layout = buildGraphLayout(state.graph, 36);
  assert.equal(layout.mode, "graph");
  for (const edge of layout.edges)
    for (const point of edge.path)
      assert.ok(layout.nodes.every((box) => !inside(point, box)));
  assert.ok(layout.edges.some((edge) => edge.from === "A" && edge.to === "D"));
});

test("dense graphs use explicit cards instead of misleading shared buses", () => {
  const nodes = Array.from({ length: 14 }, (_, index) => ({
    id: `N${index}`,
    title: `任务 ${index}`,
    dependsOn: Array.from({ length: index }, (_, parent) => `N${parent}`),
  }));
  const state = plan(emptyState(), 0, "dense", nodes);
  assert.ok(state.graph);
  const layout = buildGraphLayout(state.graph, 36);
  assert.equal(layout.mode, "cards");
  assert.ok(layout.reason);
  assert.equal(layout.nodes.length, 14);
  assert.deepEqual(layout.edges, []);
});
