import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export const STATE_ENTRY = "pi-task-dag/state";
export const MAX_NODES = 32;
const MAX_STATE_BYTES = 24 * 1024;
const Id = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$" });
const Title = Type.String({ minLength: 1, maxLength: 100 });
export const InputNodeSchema = Type.Object(
  { id: Id, title: Title, dependsOn: Type.Array(Id, { maxItems: MAX_NODES }) },
  { additionalProperties: false },
);
export type InputNode = Static<typeof InputNodeSchema>;
const NodeSchema = Type.Object(
  {
    id: Id,
    title: Title,
    dependsOn: Type.Array(Id, { maxItems: MAX_NODES }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("running"),
      Type.Literal("done"),
      Type.Literal("waiting"),
      Type.Literal("failed"),
    ]),
    evidence: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  },
  { additionalProperties: false },
);
const GraphSchema = Type.Object(
  {
    title: Title,
    nodes: Type.Array(NodeSchema, { minItems: 1, maxItems: MAX_NODES }),
  },
  { additionalProperties: false },
);
const StateSchema = Type.Object(
  {
    version: Type.Literal(1),
    revision: Type.Integer({ minimum: 0 }),
    graph: Type.Union([GraphSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type DagState = Static<typeof StateSchema>;
export type DagGraph = Static<typeof GraphSchema>;
export type DagNode = Static<typeof NodeSchema>;
export const ActionSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("complete"),
  Type.Literal("wait"),
  Type.Literal("fail"),
  Type.Literal("reopen"),
]);
export type Action = Static<typeof ActionSchema>;

export function emptyState(): DagState {
  return { version: 1, revision: 0, graph: null };
}
export function cleanText(text: string): string {
  const value = stripTerminalSequences(text)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!value) throw new Error("Task text cannot be empty.");
  return value;
}

/** Stable topological layers, not a tree: multiple parents remain explicit. */
export function layers(graph: DagGraph): DagNode[][] {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) throw new Error("Duplicate task ID.");
  for (const node of graph.nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length)
      throw new Error(`Duplicate dependencies for ${node.id}.`);
    if (node.dependsOn.some((id) => id === node.id || !ids.has(id)))
      throw new Error(`Invalid dependency for ${node.id}.`);
  }
  const seen = new Set<string>();
  const result: DagNode[][] = [];
  while (seen.size < ids.size) {
    const ready = graph.nodes.filter(
      (node) =>
        !seen.has(node.id) && node.dependsOn.every((id) => seen.has(id)),
    );
    if (!ready.length) throw new Error("Task dependencies contain a cycle.");
    result.push(ready);
    for (const node of ready) seen.add(node.id);
  }
  return result;
}

export function isReady(node: DagNode, graph: DagGraph): boolean {
  return node.dependsOn.every((id) =>
    graph.nodes.some((parent) => parent.id === id && parent.status === "done"),
  );
}

export function parseState(value: unknown): DagState {
  if (!Check(StateSchema, value))
    throw new Error("Invalid task DAG state (expected version 1).");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_STATE_BYTES)
    throw new Error(
      "DAG state exceeds the 24 KiB snapshot limit. Shorten titles/evidence or split the plan.",
    );
  if (!value.graph) return { ...value };
  const graph: DagGraph = {
    title: cleanText(value.graph.title),
    nodes: value.graph.nodes.map((node) => ({
      ...node,
      dependsOn: [...node.dependsOn],
      title: cleanText(node.title),
      ...(node.evidence ? { evidence: cleanText(node.evidence) } : {}),
      ...(node.reason ? { reason: cleanText(node.reason) } : {}),
    })),
  };
  layers(graph);
  if (graph.nodes.filter((node) => node.status === "running").length > 1)
    throw new Error("This prototype supports one running task per session.");
  for (const node of graph.nodes) {
    if (node.status !== "pending" && !isReady(node, graph))
      throw new Error(`Dependencies for ${node.id} are not complete.`);
    if (node.status === "done" && !node.evidence)
      throw new Error(`Completion evidence required for ${node.id}.`);
    if ((node.status === "waiting" || node.status === "failed") && !node.reason)
      throw new Error(`Reason required for ${node.id}.`);
  }
  return { ...value, graph };
}

function checkRevision(state: DagState, expected: number): void {
  if (state.revision !== expected)
    throw new Error(
      `Stale DAG revision: expected ${expected}, current ${state.revision}. Call dag_get.`,
    );
}

export function plan(
  state: DagState,
  expected: number,
  title: string,
  nodes: InputNode[],
): DagState {
  checkRevision(state, expected);
  return parseState({
    version: 1,
    revision: state.revision + 1,
    graph: {
      title,
      nodes: nodes.map((node) => ({ ...node, status: "pending" })),
    },
  });
}

export function update(
  state: DagState,
  expected: number,
  id: string,
  action: Action,
  note?: string,
): DagState {
  checkRevision(state, expected);
  const next = structuredClone(state);
  const graph = next.graph;
  if (!graph) throw new Error("Create a DAG with dag_plan first.");
  const node = graph.nodes.find((node) => node.id === id);
  if (!node) throw new Error(`Unknown task ${id}.`);
  if (action === "reopen") {
    if (node.status !== "done")
      throw new Error("Only completed nodes can be reopened.");
    const affected = new Set([id]);
    for (const group of layers(graph))
      for (const child of group)
        if (child.dependsOn.some((parent) => affected.has(parent)))
          affected.add(child.id);
    for (const child of graph.nodes)
      if (affected.has(child.id)) {
        child.status = "pending";
        delete child.evidence;
        child.reason =
          child.id === id ? "任务重开，待复核" : "前置变更，待复核";
      }
  } else if (action === "start") {
    if (node.status === "done" || !isReady(node, graph))
      throw new Error("Task is completed or dependencies are unfinished.");
    if (
      graph.nodes.some((other) => other.id !== id && other.status === "running")
    )
      throw new Error("Finish or pause the current running task first.");
    node.status = "running";
    delete node.reason;
    delete node.evidence;
  } else {
    if (node.status !== "running")
      throw new Error(
        "Start the task before completing, waiting or failing it.",
      );
    if (!note)
      throw new Error(
        "A concrete completion evidence or waiting/failure reason is required.",
      );
    if (action === "complete") {
      node.status = "done";
      node.evidence = cleanText(note);
      delete node.reason;
    } else {
      node.status = action === "wait" ? "waiting" : "failed";
      node.reason = cleanText(note);
    }
  }
  next.revision++;
  return parseState(next);
}

export function demoState(): DagState {
  let state = plan(emptyState(), 0, "登录功能 · 演示图", [
    { id: "A", title: "定义接口契约", dependsOn: [] },
    { id: "B", title: "实现后端接口", dependsOn: ["A"] },
    { id: "C", title: "实现前端页面", dependsOn: ["A"] },
    { id: "D", title: "联调与端到端测试", dependsOn: ["B", "C"] },
    { id: "E", title: "发布并验证", dependsOn: ["D"] },
  ]);
  state = update(state, state.revision, "A", "start");
  state = update(
    state,
    state.revision,
    "A",
    "complete",
    "演示数据，不代表实际工作。",
  );
  return update(state, state.revision, "B", "start");
}
