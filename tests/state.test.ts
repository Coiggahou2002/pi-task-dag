import assert from "node:assert/strict";
import { test } from "node:test";
import {
  demoState,
  emptyState,
  isReady,
  layers,
  parseState,
  plan,
  update,
} from "../extensions/task-dag/state.ts";

const inputs = [
  { id: "A", title: "接口契约", dependsOn: [] },
  { id: "B", title: "后端", dependsOn: ["A"] },
  { id: "C", title: "前端", dependsOn: ["A"] },
  { id: "D", title: "联调", dependsOn: ["B", "C"] },
];

test("topological layers preserve branches and joins; readiness is derived", () => {
  const state = plan(emptyState(), 0, "登录", inputs);
  const graph = state.graph;
  assert.ok(graph);
  const first = graph.nodes[0];
  assert.ok(first);
  assert.deepEqual(
    layers(graph).map((group) => group.map((node) => node.id)),
    [["A"], ["B", "C"], ["D"]],
  );
  assert.equal(isReady(first, graph), true);
  assert.equal(graph.nodes.filter((node) => isReady(node, graph)).length, 1);
});

test("cycles, missing parents, self links and duplicate identities/dependencies are rejected", () => {
  for (const nodes of [
    [{ id: "A", title: "A", dependsOn: ["A"] }],
    [{ id: "A", title: "A", dependsOn: ["B"] }],
    [
      { id: "A", title: "A", dependsOn: ["B"] },
      { id: "B", title: "B", dependsOn: ["A"] },
    ],
    [
      { id: "A", title: "A", dependsOn: [] },
      { id: "A", title: "duplicate", dependsOn: [] },
    ],
    [
      { id: "A", title: "A", dependsOn: [] },
      { id: "B", title: "B", dependsOn: ["A", "A"] },
    ],
  ])
    assert.throws(() => plan(emptyState(), 0, "test", nodes));
});

test("real transitions require completed dependencies, a started node and evidence", () => {
  let state = plan(emptyState(), 0, "登录", inputs);
  assert.throws(() => update(state, state.revision, "B", "start"));
  assert.throws(() => update(state, state.revision, "A", "complete", "tests"));
  state = update(state, state.revision, "A", "start");
  assert.throws(() => update(state, state.revision, "A", "complete"));
  assert.throws(() =>
    update(state, state.revision, "A", "complete", "\x1b[31m  "),
  );
  state = update(state, state.revision, "A", "complete", "契约测试通过");
  state = update(state, state.revision, "B", "start");
  assert.throws(() => update(state, state.revision, "C", "start"));
  state = update(state, state.revision, "B", "wait", "等待确认");
  state = update(state, state.revision, "B", "start");
  state = update(state, state.revision, "B", "fail", "测试失败");
  assert.equal(
    state.graph?.nodes.find((node) => node.id === "B")?.status,
    "failed",
  );
});

test("reopening invalidates transitive descendants but not unrelated work", () => {
  const base = demoState();
  assert.ok(base.graph);
  const state = parseState({
    ...base,
    graph: {
      ...base.graph,
      nodes: [
        ...base.graph.nodes,
        {
          id: "F",
          title: "独立",
          dependsOn: [],
          status: "done",
          evidence: "独立测试通过",
        },
      ],
    },
  });
  const reopened = update(state, state.revision, "A", "reopen");
  assert.ok(reopened.graph);
  assert.ok(
    reopened.graph.nodes
      .filter((node) => node.id !== "F")
      .every((node) => node.status === "pending"),
  );
  assert.equal(
    reopened.graph.nodes.find((node) => node.id === "F")?.status,
    "done",
  );
  assert.equal(
    state.graph?.nodes.find((node) => node.id === "A")?.status,
    "done",
    "updates must not mutate the old snapshot",
  );
});

test("optimistic revisions reject stale edits and invalid mutations leave state untouched", () => {
  const state = demoState();
  const before = JSON.stringify(state);
  assert.throws(() => plan(state, 0, "stale", inputs), /Stale/);
  assert.throws(() => update(state, 0, "B", "complete", "tests"), /Stale/);
  assert.throws(
    () => update(state, state.revision, "missing", "start"),
    /Unknown/,
  );
  assert.equal(JSON.stringify(state), before);
});

test("persisted state validates schema, invariants, terminal controls and byte budget", () => {
  assert.deepEqual(parseState(emptyState()), emptyState());
  for (const value of [
    null,
    {},
    { ...emptyState(), version: 2 },
    { ...emptyState(), extra: true },
    { ...emptyState(), revision: -1 },
  ])
    assert.throws(() => parseState(value));
  const sanitized = plan(emptyState(), 0, "\x1b[31m登录\x1b[0m", [
    { id: "A", title: "修复\n登录", dependsOn: [] },
  ]);
  assert.equal(sanitized.graph?.title, "登录");
  assert.equal(sanitized.graph?.nodes[0]?.title, "修复 登录");
  assert.throws(() =>
    parseState({
      version: 1,
      revision: 1,
      graph: {
        title: "bad",
        nodes: [{ id: "A", title: "A", dependsOn: [], status: "done" }],
      },
    }),
  );
  assert.throws(
    () =>
      parseState({
        version: 1,
        revision: 1,
        graph: {
          title: "oversize",
          nodes: Array.from({ length: 32 }, (_, id) => ({
            id: `N${id}`,
            title: "title",
            dependsOn: [],
            status: "done",
            evidence: "字".repeat(500),
          })),
        },
      }),
    /24 KiB/,
  );
});
