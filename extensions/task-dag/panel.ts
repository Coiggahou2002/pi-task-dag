import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  isReady,
  layers,
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

export function summary(state: DagState): string {
  const graph = state.graph;
  if (!graph) return "尚无任务图";
  const done = graph.nodes.filter((node) => node.status === "done").length;
  const ready = graph.nodes.filter(
    (node) => node.status === "pending" && isReady(node, graph),
  ).length;
  return `${done}/${graph.nodes.length} 完成 · ${ready} 可开始`;
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

export class DagPanel implements Component {
  private readonly rowIds = new Map<number, string>();
  constructor(
    private readonly view: () => Presentation,
    private readonly theme: () => Pick<Theme, "fg" | "bold">,
    private readonly inspect: (id: string) => void,
  ) {}
  invalidate(): void {
    this.rowIds.clear();
  }

  render(width: number): string[] {
    this.rowIds.clear();
    if (width <= 0) return [];
    const view = this.view();
    const graph = view.state.graph;
    if (!graph) return [];
    const theme = this.theme();
    const lines = [
      theme.bold("TASK DAG"),
      theme.fg(
        view.demo ? "warning" : "muted",
        view.demo ? "演示图 · 非实际进度" : graph.title,
      ),
      theme.fg("muted", summary(view.state)),
      theme.fg("dim", `r${view.state.revision} · 点击节点看详情`),
      "",
    ];
    for (const [rank, group] of layers(graph).entries()) {
      lines.push(theme.fg("dim", `┄ 依赖层 ${rank + 1} ┄`));
      for (const node of group) {
        const label = nodeLabel(node, graph, view.activeNode);
        const icon =
          node.status === "done"
            ? "✓"
            : node.status === "running"
              ? view.activeNode === node.id
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
        this.rowIds.set(lines.length, node.id);
        lines.push(theme.fg(color, `${icon} ${node.id} ${node.title}`));
        this.rowIds.set(lines.length, node.id);
        lines.push(
          theme.fg(
            "dim",
            `  ${label}${node.dependsOn.length ? ` · ← ${node.dependsOn.join(" + ")}` : " · 无前置"}`,
          ),
        );
      }
      lines.push("");
    }
    lines.push(theme.fg("dim", "/dag 查看 · /dag hide 收起"));
    return lines.map((line) =>
      truncateToWidth(theme.fg("borderMuted", "│ ") + line, width, "…"),
    );
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    const id = this.rowIds.get(event.y);
    if (!id) return undefined;
    this.inspect(id);
    return { handled: true };
  }
}
