import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stripTerminalSequences,
  visibleWidth,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  DagPanel,
  GRAPH_HEADER_LINES,
  nodeDetails,
  nodeLabel,
  type Presentation,
} from "../extensions/task-dag/panel.ts";
import { buildGraphLayout } from "../extensions/task-dag/graph-layout.ts";
import {
  demoState,
  emptyState,
  plan,
  update,
} from "../extensions/task-dag/state.ts";

const theme: Pick<Theme, "fg" | "bold"> = {
  fg: (_color, text) => text,
  bold: (text) => text,
};
function click(x: number, y: number): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x,
    y,
    screenX: x + 102,
    screenY: y,
    width: 38,
    height: 40,
    shift: false,
    alt: false,
    ctrl: false,
  };
}
function wideState() {
  return plan(emptyState(), 0, "wide graph", [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `R${index}`,
      title: `并行任务 ${index}`,
      dependsOn: [],
    })),
    {
      id: "JOIN",
      title: "汇合",
      dependsOn: Array.from({ length: 6 }, (_, index) => `R${index}`),
    },
  ]);
}

test("boxed DAG exposes the fork, both parents of the join, and explicit demo labels", () => {
  const view: Presentation = {
    state: demoState(),
    demo: true,
    activeNode: "B",
  };
  const panel = new DagPanel(
    () => view,
    () => theme,
    () => {},
  );
  for (const width of [0, 1, 10, 38, 80])
    for (const line of panel.render(width))
      assert.ok(visibleWidth(line) <= width);
  const text = panel.render(38).map(stripTerminalSequences).join("\n");
  assert.match(text, /演示图 · 非实际进度/);
  assert.match(text, /←B\+C/);
  assert.match(text, /可开始/);
  assert.match(text, /依赖阻塞/);
  assert.match(text, /┌─/);
  assert.match(text, /▼/);
  assert.match(text, /实现后端接口/);
  assert.match(text, /实现前端页面/);
  assert.doesNotMatch(text, /依赖层/);
  assert.match(nodeDetails(view, "A"), /演示数据，不代表实际工作/);
});

test("persisted running status is not claimed as active after idle/resume", () => {
  const state = demoState();
  const graph = state.graph;
  assert.ok(graph);
  const running = graph.nodes.find((node) => node.id === "B");
  assert.ok(running);
  assert.equal(nodeLabel(running, graph, undefined), "待核对");
  assert.equal(nodeLabel(running, graph, "B"), "进行中");
});

test("two boxes on the same row have separate 2-D click identities, including after narrow resize", () => {
  const state = demoState();
  assert.ok(state.graph);
  const inspected: string[] = [];
  const panel = new DagPanel(
    () => ({ state, demo: true, activeNode: "B" }),
    () => theme,
    (id) => inspected.push(id),
  );
  const layout = buildGraphLayout(state.graph, 36);
  panel.render(38);
  panel.render(0);
  panel.render(1);
  panel.render(38);
  for (const id of ["B", "C"]) {
    const box = layout.nodes.find((node) => node.id === id);
    assert.ok(box);
    const result = panel.handleMouse(
      click(2 + box.x + 1, GRAPH_HEADER_LINES + box.y + 1),
    );
    assert.equal(result?.handled, true);
    assert.equal(result.focus, undefined);
  }
  assert.deepEqual(inspected, ["B", "C"]);
  const edge = layout.edges[0];
  assert.ok(edge);
  assert.equal(
    panel.handleMouse(
      click(2 + edge.start.x, GRAPH_HEADER_LINES + edge.start.y),
    ),
    undefined,
  );
  panel.invalidate();
  panel.render(38);
  const b = layout.nodes.find((node) => node.id === "B");
  assert.ok(b);
  panel.handleMouse(click(2 + b.x + 1, GRAPH_HEADER_LINES + b.y + 1));
  assert.deepEqual(inspected, ["B", "C", "B"]);
});

test("wide diagrams pan, rebase hit boxes, and keep every node reachable without mutating progress", () => {
  const state = wideState();
  assert.ok(state.graph);
  const before = JSON.stringify(state);
  const inspected: string[] = [];
  let changed = 0;
  const panel = new DagPanel(
    () => ({ state, demo: false, activeNode: undefined }),
    () => theme,
    (id) => inspected.push(id),
    () => changed++,
  );
  const layout = buildGraphLayout(state.graph, 36);
  assert.equal(layout.mode, "graph");
  assert.ok(layout.width > 36);
  assert.match(panel.render(38).join("\n"), /横向 1–36/);
  panel.panColumns(999);
  const right = panel.render(38).join("\n");
  assert.match(right, /\/dag left\|right/);
  const box = [...layout.nodes].sort((a, b) => b.x - a.x)[0];
  assert.ok(box);
  const offset = layout.width - 36;
  panel.handleMouse(
    click(2 + box.x - offset + 1, GRAPH_HEADER_LINES + box.y + 1),
  );
  assert.deepEqual(inspected, [box.id]);
  panel.focus();
  assert.match(panel.render(38).join("\n"), /横向 1–36/);
  assert.ok(changed >= 2);
  assert.equal(JSON.stringify(state), before);
});

test("Shift+wheel pans only; ordinary wheel remains available to the native ScrollView", () => {
  const state = wideState();
  const panel = new DagPanel(
    () => ({ state, demo: false, activeNode: undefined }),
    () => theme,
    () => {},
  );
  panel.render(38);
  const event: TuiMouseEvent = {
    ...click(20, 8),
    type: "wheel",
    button: "none",
    wheelDelta: 3,
    shift: true,
  };
  assert.equal(panel.handleMouse(event)?.handled, true);
  panel.handleMouse(event);
  panel.handleMouse(event);
  assert.match(panel.render(38).join("\n"), /横向 37–72/);
  assert.equal(panel.handleMouse({ ...event, shift: false }), undefined);
});

test("manual panning survives progress updates until focus explicitly returns to the active node", () => {
  let state = wideState();
  assert.ok(state.graph);
  let activeNode: string | undefined;
  const panel = new DagPanel(
    () => ({ state, demo: false, activeNode }),
    () => theme,
    () => {},
  );
  const layout = buildGraphLayout(state.graph, 36);
  const left = [...layout.nodes]
    .filter((box) => box.id.startsWith("R"))
    .sort((a, b) => a.x - b.x)[0];
  assert.ok(left);
  panel.render(38);
  panel.panColumns(999);
  panel.render(38);
  state = update(state, state.revision, left.id, "start");
  activeNode = left.id;
  const manual = panel.render(38);
  assert.match(
    manual.join("\n"),
    new RegExp(`横向 ${layout.width - 35}–${layout.width}`),
  );
  assert.equal(panel.render(38), manual, "unchanged frames are cached");
  panel.focus();
  const focused = panel.render(38).map(stripTerminalSequences).join("\n");
  assert.match(focused, new RegExp(`● ${left.id}`));
});

test("long IDs, CJK and emoji fit the viewport and full identity remains in details", () => {
  const id = "long_identity_123456789";
  const state = plan(emptyState(), 0, "中文 👩‍💻", [
    { id, title: "中文 👩‍💻 很长的任务说明与验证步骤", dependsOn: [] },
  ]);
  const view = { state, demo: false, activeNode: undefined };
  const panel = new DagPanel(
    () => view,
    () => theme,
    () => {},
  );
  for (const width of [1, 12, 22, 38, 80])
    for (const line of panel.render(width))
      assert.ok(visibleWidth(line) <= width);
  assert.match(nodeDetails(view, id), new RegExp(id));
  assert.match(nodeDetails(view, id), /很长的任务说明/);
});
