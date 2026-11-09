import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  DagPanel,
  nodeDetails,
  nodeLabel,
  type Presentation,
} from "../extensions/task-dag/panel.ts";
import { demoState } from "../extensions/task-dag/state.ts";

const theme: Pick<Theme, "fg" | "bold"> = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

test("layered DAG exposes both parents of a join and labels demo data explicitly", () => {
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
  const text = panel.render(38).join("\n");
  assert.match(text, /演示图 · 非实际进度/);
  assert.match(text, /← B \+ C/);
  assert.match(text, /可开始/);
  assert.match(text, /依赖阻塞/);
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

test("clicking a task opens its identity without taking keyboard focus", () => {
  const inspected: string[] = [];
  const panel = new DagPanel(
    () => ({ state: demoState(), demo: true, activeNode: "B" }),
    () => theme,
    (id) => inspected.push(id),
  );
  panel.render(38);
  const result = panel.handleMouse({
    type: "click",
    button: "left",
    x: 3,
    y: 10,
    screenX: 105,
    screenY: 10,
    width: 38,
    height: 30,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.deepEqual(inspected, ["B"]);
  assert.equal(result?.handled, true);
  assert.equal(result?.focus, undefined);
});
