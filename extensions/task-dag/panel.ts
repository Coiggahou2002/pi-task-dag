import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  buildGraphLayout,
  cardLayout,
  type GraphLayout,
} from "./graph-layout.ts";
import { paintGraph, rasterizeEdges, type EdgeRaster } from "./graph-paint.ts";
import { nodeLabel, summary, type Presentation } from "./presentation.ts";
import type { DagState } from "./state.ts";
export {
  nodeDetails,
  nodeLabel,
  summary,
  type Presentation,
} from "./presentation.ts";

export const GRAPH_HEADER_LINES = 5;
const PANEL_INSET = 2;
const MIN_DIAGRAM_WIDTH = 10;
const PAN_WHEEL_COLUMNS = 4;
interface HitBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
type PanelTheme = Pick<Theme, "fg" | "bold">;
interface Geometry {
  key: string;
  layout: GraphLayout;
  raster: EdgeRaster;
}
interface Frame {
  state: DagState;
  activeNode: string | undefined;
  demo: boolean;
  width: number;
  offset: number;
  theme: PanelTheme;
  lines: string[];
}

export class DagPanel implements Component {
  private hits: HitBox[] = [];
  private geometry: Geometry | undefined;
  private frame: Frame | undefined;
  private manualOffset: number | undefined;
  private autoOffset = 0;
  private renderedOffset = 0;
  private bodyWidth = 0;

  constructor(
    private readonly view: () => Presentation,
    private readonly theme: () => PanelTheme,
    private readonly inspect: (id: string) => void,
    private readonly changed: () => void = () => {},
  ) {}
  invalidate(): void {
    this.frame = undefined;
    this.hits = [];
  }

  panColumns(columns: number): void {
    if (!this.geometry || !Number.isFinite(columns)) return;
    this.manualOffset = Math.max(
      0,
      Math.min(
        Math.max(0, this.geometry.layout.width - this.bodyWidth),
        (this.manualOffset ?? this.renderedOffset) + Math.trunc(columns),
      ),
    );
    this.invalidate();
    this.changed();
  }
  focus(): void {
    this.manualOffset = undefined;
    this.autoOffset = 0;
    this.invalidate();
    this.changed();
  }

  private shape(view: Presentation, width: number): Geometry {
    const graph = view.state.graph;
    if (!graph) throw new Error("Missing task graph.");
    const key = JSON.stringify({
      width,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        dependsOn: node.dependsOn,
      })),
    });
    if (this.geometry?.key === key) return this.geometry;
    let layout: GraphLayout;
    let raster: EdgeRaster;
    try {
      layout = buildGraphLayout(graph, width);
      raster = rasterizeEdges(layout);
      if (raster.ambiguous) {
        layout = cardLayout(graph, width, "连线会混淆依赖，改用节点卡片");
        raster = rasterizeEdges(layout);
      }
    } catch (error) {
      // Rendering is optional. Surface the failure and preserve the authoritative graph.
      const message = stripTerminalSequences(
        error instanceof Error ? error.message : String(error),
      ).replace(/\p{Cc}/gu, " ");
      layout = cardLayout(graph, width, `布局失败，使用卡片：${message}`);
      raster = rasterizeEdges(layout);
    }
    this.geometry = { key, layout, raster };
    this.manualOffset = undefined;
    this.autoOffset = 0;
    return this.geometry;
  }

  render(width: number): string[] {
    if (width <= 0) {
      this.hits = [];
      this.frame = undefined;
      return [];
    }
    const view = this.view();
    const graph = view.state.graph;
    const theme = this.theme();
    if (!graph) {
      this.hits = [];
      this.frame = undefined;
      return [];
    }
    const bodyWidth = Math.max(1, width - PANEL_INSET);
    this.bodyWidth = bodyWidth;
    if (bodyWidth < MIN_DIAGRAM_WIDTH) {
      this.hits = [];
      this.frame = undefined;
      return [
        "TASK DAG",
        summary(view.state),
        ...graph.nodes.map(
          (node) =>
            `${node.id} ${node.title} · ${nodeLabel(node, graph, view.activeNode)}`,
        ),
      ].map((line) => truncateToWidth(theme.fg("muted", line), width, "…"));
    }
    const { layout, raster } = this.shape(view, bodyWidth);
    const maxOffset = Math.max(0, layout.width - bodyWidth);
    const active =
      view.activeNode ??
      graph.nodes.find((node) => node.status === "running")?.id;
    const focusBox = layout.nodes.find((box) => box.id === active);
    if (focusBox)
      this.autoOffset = Math.max(
        0,
        Math.min(
          maxOffset,
          Math.round(focusBox.x + focusBox.width / 2 - bodyWidth / 2),
        ),
      );
    const offset = Math.max(
      0,
      Math.min(maxOffset, this.manualOffset ?? this.autoOffset),
    );
    this.renderedOffset = offset;
    const old = this.frame;
    if (
      old &&
      old.state === view.state &&
      old.activeNode === view.activeNode &&
      old.demo === view.demo &&
      old.width === width &&
      old.offset === offset &&
      old.theme === theme
    )
      return old.lines;
    const header = [
      theme.bold("TASK DAG"),
      theme.fg(
        view.demo ? "warning" : "muted",
        view.demo ? "演示图 · 非实际进度" : graph.title,
      ),
      theme.fg("muted", summary(view.state)),
      theme.fg(
        "dim",
        maxOffset
          ? `r${view.state.revision} · 横向 ${offset + 1}–${Math.min(layout.width, offset + bodyWidth)}/${layout.width}`
          : `r${view.state.revision} · 点击方框看详情`,
      ),
      layout.reason ? theme.fg("warning", layout.reason) : "",
    ];
    if (header.length !== GRAPH_HEADER_LINES)
      throw new Error("Graph header geometry changed.");
    const painted = paintGraph(layout, raster, view, bodyWidth, theme);
    const lines = [
      ...header,
      ...painted.lines.map((line) =>
        sliceByColumn(line, offset, bodyWidth, true),
      ),
    ];
    this.hits = layout.nodes.flatMap((box) => {
      const left = Math.max(0, box.x + painted.padding - offset);
      const right = Math.min(
        bodyWidth,
        box.x + painted.padding - offset + box.width,
      );
      return right > left
        ? [
            {
              id: box.id,
              x: left + PANEL_INSET,
              y: box.y + GRAPH_HEADER_LINES,
              width: right - left,
              height: box.height,
            },
          ]
        : [];
    });
    if (layout.reason) lines.push(theme.fg("warning", layout.reason));
    if (raster.crossings) lines.push(theme.fg("dim", "╳ 为交叉，不是依赖汇合"));
    if (maxOffset)
      lines.push(
        theme.fg("dim", "/dag left|right · Shift+滚轮平移"),
        theme.fg("dim", "/dag focus 聚焦当前节点"),
      );
    lines.push(theme.fg("dim", "/dag 查看 · /dag hide 收起"));
    const framed = lines.map((line) =>
      truncateToWidth(theme.fg("borderMuted", "│ ") + line, width, "…"),
    );
    this.frame = {
      state: view.state,
      activeNode: view.activeNode,
      demo: view.demo,
      width,
      offset,
      theme,
      lines: framed,
    };
    return framed;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (
      event.type === "wheel" &&
      event.shift &&
      event.wheelDelta !== undefined
    ) {
      this.panColumns(event.wheelDelta * PAN_WHEEL_COLUMNS);
      return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return undefined;
    const box = this.hits.find(
      (hit) =>
        event.x >= hit.x &&
        event.x < hit.x + hit.width &&
        event.y >= hit.y &&
        event.y < hit.y + hit.height,
    );
    if (!box) return undefined;
    this.inspect(box.id);
    return { handled: true };
  }
}
