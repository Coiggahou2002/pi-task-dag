import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildGraphLayout,
  inside,
} from "../extensions/task-dag/graph-layout.ts";
import { rasterizeEdges } from "../extensions/task-dag/graph-paint.ts";
import { DagPanel } from "../extensions/task-dag/panel.ts";
import {
  emptyState,
  plan,
  type InputNode,
} from "../extensions/task-dag/state.ts";

test("seeded multi-rank DAGs stay obstacle-safe, bounded, and explicit about ambiguous routes", () => {
  let seed = 7349;
  let diagrams = 0;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let sample = 0; sample < 30; sample++) {
    const nodes: InputNode[] = [];
    for (let index = 0; index < 8 + (sample % 9); index++)
      nodes.push({
        id: `N${index}`,
        title: `测试任务 ${index} 👩‍💻`,
        dependsOn: nodes.filter(() => random() < 0.2).map((node) => node.id),
      });
    const state = plan(emptyState(), 0, `测试样本 ${sample}`, nodes);
    assert.ok(state.graph);
    const layout = buildGraphLayout(state.graph, 36);
    const raster = rasterizeEdges(layout);
    for (const edge of layout.edges)
      for (const point of edge.path) {
        assert.ok(
          point.x >= 0 &&
            point.x < layout.width &&
            point.y >= 0 &&
            point.y < layout.height,
        );
        assert.ok(layout.nodes.every((box) => !inside(point, box)));
      }
    const panel = new DagPanel(
      () => ({ state, demo: false, activeNode: undefined }),
      () => ({ fg: (_color, text) => text, bold: (text) => text }),
      () => {},
    );
    const lines = panel.render(38);
    for (const line of lines) assert.ok(visibleWidth(line) <= 38);
    if (raster.ambiguous)
      assert.match(
        lines.map(stripTerminalSequences).join("\n"),
        /连线会混淆依赖/,
      );
    else if (layout.mode === "graph") diagrams++;
  }
  assert.ok(
    diagrams >= 10,
    `Only ${diagrams}/30 samples produced clear diagrams.`,
  );
});
