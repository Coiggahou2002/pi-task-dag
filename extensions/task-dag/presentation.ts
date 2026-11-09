import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  isReady,
  type DagGraph,
  type DagNode,
  type DagState,
} from "./state.ts";

export interface Presentation {
  state: DagState;
  demo: boolean;
  activeNode: string | undefined;
}

export function nodeLabel(
  node: DagNode,
  graph: DagGraph,
  activeNode: string | undefined,
): string {
  switch (node.status) {
    case "done":
      return "已完成";
    case "running":
      return activeNode === node.id ? "进行中" : "待核对";
    case "waiting":
      return "等待确认";
    case "failed":
      return "失败";
    case "pending":
      return isReady(node, graph) ? "可开始" : "依赖阻塞";
  }
}
export function nodeAppearance(
  node: DagNode,
  graph: DagGraph,
  activeNode: string | undefined,
): { icon: string; color: ThemeColor; label: string } {
  const label = nodeLabel(node, graph, activeNode);
  const icon =
    node.status === "done"
      ? "✓"
      : node.status === "running"
        ? activeNode === node.id
          ? "●"
          : "◐"
        : node.status === "waiting"
          ? "?"
          : node.status === "failed"
            ? "×"
            : isReady(node, graph)
              ? "○"
              : "◇";
  const color =
    node.status === "done"
      ? "success"
      : node.status === "failed"
        ? "error"
        : label === "待核对" || node.status === "waiting"
          ? "warning"
          : node.status === "running"
            ? "accent"
            : "muted";
  return { icon, color, label };
}
export function summary(state: DagState): string {
  const graph = state.graph;
  if (!graph) return "尚无任务图";
  return `${graph.nodes.filter((node) => node.status === "done").length}/${graph.nodes.length} 完成 · ${graph.nodes.filter((node) => node.status === "pending" && isReady(node, graph)).length} 可开始`;
}
export function nodeDetails(view: Presentation, id: string): string {
  const graph = view.state.graph;
  const node = graph?.nodes.find((node) => node.id === id);
  if (!graph || !node)
    throw new Error("Task is no longer in the active graph.");
  return [
    view.demo ? "演示数据，不代表实际工作" : graph.title,
    `节点：${node.id} · ${node.title}`,
    `状态：${nodeLabel(node, graph, view.activeNode)}`,
    `前置：${node.dependsOn.join(" + ") || "无"}`,
    `原因：${node.reason ?? "无"}`,
    `Agent 完成依据：${node.evidence ?? "尚未提供"}`,
    `图版本：${view.state.revision}`,
  ].join("\n\n");
}
