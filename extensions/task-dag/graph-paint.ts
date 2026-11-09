import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  compositeTuiLine,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  pointKey,
  related,
  type GraphLayout,
  type Point,
  type RoutedEdge,
} from "./graph-layout.ts";
import { nodeAppearance, type Presentation } from "./presentation.ts";

const UP = 1;
const DOWN = 2;
const LEFT = 4;
const RIGHT = 8;
const GLYPHS = new Map<number, string>([
  [UP, "│"],
  [DOWN, "│"],
  [UP | DOWN, "│"],
  [LEFT, "─"],
  [RIGHT, "─"],
  [LEFT | RIGHT, "─"],
  [UP | RIGHT, "└"],
  [UP | LEFT, "┘"],
  [DOWN | RIGHT, "┌"],
  [DOWN | LEFT, "┐"],
  [UP | DOWN | RIGHT, "├"],
  [UP | DOWN | LEFT, "┤"],
  [LEFT | RIGHT | DOWN, "┬"],
  [LEFT | RIGHT | UP, "┴"],
  [UP | DOWN | LEFT | RIGHT, "┼"],
]);
interface Stroke {
  edge: RoutedEdge;
  mask: number;
  arrow: boolean;
}
export interface EdgeRaster {
  cells: { x: number; y: number; glyph: string }[];
  crossings: boolean;
  ambiguous: boolean;
}

export function rasterizeEdges(layout: GraphLayout): EdgeRaster {
  const occupied = new Map<string, { point: Point; strokes: Stroke[] }>();
  for (const edge of layout.edges) {
    const first = edge.path[0];
    const last = edge.path.at(-1);
    if (
      !first ||
      !last ||
      pointKey(first) !== pointKey(edge.start) ||
      pointKey(last) !== pointKey(edge.end)
    )
      throw new Error("Route does not connect its ports.");
    const strokes = new Map<string, { point: Point; mask: number }>();
    const mark = (point: Point, mask: number): void => {
      const key = pointKey(point);
      const cell = strokes.get(key);
      if (cell) cell.mask |= mask;
      else strokes.set(key, { point, mask });
    };
    mark(edge.start, UP);
    mark(edge.end, DOWN);
    for (let index = 1; index < edge.path.length; index++) {
      const a = edge.path[index - 1];
      const b = edge.path[index];
      if (!a || !b || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1)
        throw new Error("Invalid orthogonal route.");
      const mask = b.x > a.x ? RIGHT : b.x < a.x ? LEFT : b.y > a.y ? DOWN : UP;
      const reverse =
        mask === RIGHT
          ? LEFT
          : mask === LEFT
            ? RIGHT
            : mask === DOWN
              ? UP
              : DOWN;
      mark(a, mask);
      mark(b, reverse);
    }
    for (const [key, cell] of strokes) {
      const stroke = {
        edge,
        mask: cell.mask,
        arrow: key === pointKey(edge.end),
      };
      const previous = occupied.get(key);
      if (previous) previous.strokes.push(stroke);
      else occupied.set(key, { point: cell.point, strokes: [stroke] });
    }
  }
  let crossings = false;
  let ambiguous = false;
  const cells = [...occupied.values()].map(({ point, strokes }) => {
    let mask = 0;
    let arrow = false;
    let crossing = false;
    for (const [index, a] of strokes.entries()) {
      mask |= a.mask;
      arrow ||= a.arrow;
      for (const b of strokes.slice(index + 1))
        if (!related(a.edge, b.edge)) {
          if ((a.mask & b.mask) !== 0 || a.arrow || b.arrow) ambiguous = true;
          crossing = true;
        }
    }
    crossings ||= crossing;
    const glyph = crossing ? "╳" : arrow ? "▼" : GLYPHS.get(mask);
    if (!glyph) throw new Error("Invalid edge direction mask.");
    return { ...point, glyph };
  });
  return { cells, crossings, ambiguous };
}

export function paintGraph(
  layout: GraphLayout,
  raster: EdgeRaster,
  view: Presentation,
  viewportWidth: number,
  theme: Pick<Theme, "fg">,
): { lines: string[]; padding: number } {
  const graph = view.state.graph;
  if (!graph) return { lines: [], padding: 0 };
  if (raster.ambiguous)
    throw new Error("Ambiguous routes must be presented as dependency cards.");
  const canvasWidth = Math.max(layout.width, viewportWidth);
  const padding = Math.max(0, Math.floor((viewportWidth - layout.width) / 2));
  const grid = Array.from({ length: layout.height }, () =>
    Array<string>(canvasWidth).fill(" "),
  );
  for (const cell of raster.cells) {
    const row = grid[cell.y];
    if (!row || cell.x < 0 || cell.x + padding >= canvasWidth)
      throw new Error("Edge is outside the canvas.");
    row[cell.x + padding] = cell.glyph;
  }
  const lines = grid.map((row) => theme.fg("dim", row.join("")));
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const box of layout.nodes) {
    const node = nodeMap.get(box.id);
    if (!node) throw new Error("Graph node disappeared during rendering.");
    const appearance = nodeAppearance(node, graph, view.activeNode);
    const inner = box.width - 2;
    const fit = (value: string): string => {
      const text = truncateToWidth(value, inner, "…");
      return `│${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))}│`;
    };
    const top = Array<string>(box.width).fill("─");
    top[0] = "┌";
    top[box.width - 1] = "┐";
    const bottom = Array<string>(box.width).fill("─");
    bottom[0] = "└";
    bottom[box.width - 1] = "┘";
    for (const edge of layout.edges) {
      if (edge.to === box.id) top[edge.end.x - box.x] = "┴";
      if (edge.from === box.id) bottom[edge.start.x - box.x] = "┬";
    }
    const rows = [
      top.join(""),
      fit(`${appearance.icon} ${node.id}`),
      fit(node.title),
      fit(
        `${appearance.label}${node.dependsOn.length ? `←${node.dependsOn.join("+")}` : ""}`,
      ),
      bottom.join(""),
    ];
    if (rows.length !== box.height)
      throw new Error("Node box height does not match its content.");
    for (const [index, row] of rows.entries()) {
      const y = box.y + index;
      const base = lines[y];
      if (base === undefined) throw new Error("Node is outside the canvas.");
      lines[y] = compositeTuiLine(
        base,
        theme.fg(appearance.color, row),
        box.x + padding,
        box.width,
        canvasWidth,
      );
    }
  }
  return { lines, padding };
}
