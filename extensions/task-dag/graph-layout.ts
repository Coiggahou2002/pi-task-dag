import {
  Graph,
  layout,
  type GraphLabel,
  type NodeLabel,
  type EdgeLabel,
} from "@dagrejs/dagre";
import Pathfinding from "pathfinding";
import { layers, type DagGraph } from "./state.ts";

export const BOX_HEIGHT = 5;
const MAX_BOX_WIDTH = 15;
const MIN_BOX_WIDTH = 10;
const NODE_GAP = 4;
const RANK_GAP = 3;
const MARGIN = 1;
const PORT_INSET = 3;
const MAX_ROUTED_EDGES = 80;
const MAX_CANVAS_CELLS = 12000;

export interface Point {
  x: number;
  y: number;
}
export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RoutedEdge {
  from: string;
  to: string;
  start: Point;
  end: Point;
  path: Point[];
}
interface LayoutGeometry {
  width: number;
  height: number;
  nodes: NodeBox[];
}
export type GraphLayout = LayoutGeometry &
  (
    | { mode: "graph"; edges: RoutedEdge[]; reason?: never }
    | { mode: "cards"; edges: []; reason: string }
  );

export function inside(point: Point, box: NodeBox): boolean {
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}
export function related(
  a: Pick<RoutedEdge, "from" | "to">,
  b: Pick<RoutedEdge, "from" | "to">,
): boolean {
  return a.from === b.from || a.to === b.to;
}
export function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export function cardLayout(
  graph: DagGraph,
  width: number,
  reason: string,
): GraphLayout {
  const nodes = layers(graph)
    .flat()
    .map((node, index) => ({
      id: node.id,
      x: 0,
      y: index * (BOX_HEIGHT + 1),
      width: Math.max(4, width),
      height: BOX_HEIGHT,
    }));
  return {
    mode: "cards",
    width: Math.max(4, width),
    height: nodes.length * (BOX_HEIGHT + 1),
    nodes,
    edges: [],
    reason,
  };
}

/** Dagre handles ordering; A* routes in terminal cells with all node rectangles blocked. */
export function buildGraphLayout(
  graph: DagGraph,
  viewportWidth: number,
): GraphLayout {
  const ordered = layers(graph).flat();
  const edgeCount = ordered.reduce(
    (count, node) => count + node.dependsOn.length,
    0,
  );
  if (viewportWidth < MIN_BOX_WIDTH || edgeCount > MAX_ROUTED_EDGES)
    return cardLayout(graph, viewportWidth, "图较密或窗口太窄，按依赖卡片展示");
  const boxWidth = Math.min(
    MAX_BOX_WIDTH,
    Math.max(
      MIN_BOX_WIDTH,
      Math.floor((viewportWidth - NODE_GAP - MARGIN * 2) / 2),
    ),
  );
  const g = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_GAP,
    ranksep: RANK_GAP,
    edgesep: 1,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  for (const node of ordered)
    g.setNode(node.id, { width: boxWidth, height: BOX_HEIGHT });
  for (const node of ordered)
    for (const parent of node.dependsOn) g.setEdge(parent, node.id, {});
  layout(g);
  const nodes: NodeBox[] = ordered.map((node) => {
    const value = g.node(node.id);
    if (
      typeof value.x !== "number" ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y)
    )
      throw new Error("Dagre returned invalid node coordinates.");
    return {
      id: node.id,
      x: Math.round(value.x - boxWidth / 2),
      y: Math.round(value.y - BOX_HEIGHT / 2),
      width: boxWidth,
      height: BOX_HEIGHT,
    };
  });
  const width = Math.max(
    viewportWidth > 0 ? 1 : 0,
    ...nodes.map((node) => node.x + node.width + MARGIN),
  );
  const height = Math.max(
    1,
    ...nodes.map((node) => node.y + node.height + MARGIN),
  );
  if (width * height > MAX_CANVAS_CELLS)
    return cardLayout(graph, viewportWidth, "图较大，按依赖卡片展示");
  const boxes = new Map(nodes.map((node) => [node.id, node]));
  const base = new Pathfinding.Grid(width, height);
  for (const box of nodes)
    for (let y = box.y; y < box.y + box.height; y++)
      for (let x = box.x; x < box.x + box.width; x++)
        base.setWalkableAt(x, y, false);
  const finder = new Pathfinding.AStarFinder({ allowDiagonal: false });
  const edges: RoutedEdge[] = [];
  const occupied = new Map<string, { point: Point; owners: RoutedEdge[] }>();
  const pointsFrom = (cells: number[][]): Point[] =>
    cells.map((cell) => {
      const [x, y] = cell;
      if (x === undefined || y === undefined)
        throw new Error("Pathfinder returned an invalid cell.");
      return { x, y };
    });
  const route = (grid: Pathfinding.Grid, start: Point, end: Point): Point[] => {
    // Prefer low-bend Manhattan candidates over equally short A* staircases.
    const middle = Math.floor((start.y + end.y) / 2);
    const candidates = [
      [
        [start.x, start.y],
        [end.x, start.y],
        [end.x, end.y],
      ],
      [
        [start.x, start.y],
        [start.x, middle],
        [end.x, middle],
        [end.x, end.y],
      ],
      [
        [start.x, start.y],
        [start.x, end.y],
        [end.x, end.y],
      ],
    ];
    for (const candidate of candidates) {
      const path = pointsFrom(Pathfinding.Util.expandPath(candidate));
      if (
        path.length &&
        path.every((point) => grid.isWalkableAt(point.x, point.y))
      )
        return path;
    }
    return pointsFrom(finder.findPath(start.x, start.y, end.x, end.y, grid));
  };
  for (const edge of g.edges()) {
    const from = boxes.get(edge.v);
    const to = boxes.get(edge.w);
    const points = g.edge(edge).points;
    const first = points?.[0];
    const last = points?.at(-1);
    if (
      !from ||
      !to ||
      !first ||
      !last ||
      !Number.isFinite(first.x) ||
      !Number.isFinite(last.x)
    )
      throw new Error("Dagre returned an invalid edge.");
    const start = {
      x: Math.max(
        from.x + PORT_INSET,
        Math.min(from.x + from.width - 1 - PORT_INSET, Math.round(first.x)),
      ),
      y: from.y + from.height,
    };
    const end = {
      x: Math.max(
        to.x + PORT_INSET,
        Math.min(to.x + to.width - 1 - PORT_INSET, Math.round(last.x)),
      ),
      y: to.y - 1,
    };
    const identity = { from: edge.v, to: edge.w };
    const preferred = base.clone();
    for (const cell of occupied.values())
      if (cell.owners.some((owner) => !related(owner, identity)))
        preferred.setWalkableAt(cell.point.x, cell.point.y, false);
    // Try avoiding other edges first, then allow clearly marked crossings if space is tight.
    let path = route(preferred, start, end);
    if (!path.length) path = route(base.clone(), start, end);
    if (!path.length)
      return cardLayout(graph, viewportWidth, "无法清晰连线，按依赖卡片展示");
    const routed: RoutedEdge = { ...identity, start, end, path };
    for (const point of path) {
      const key = pointKey(point);
      const previous = occupied.get(key);
      if (previous) previous.owners.push(routed);
      else occupied.set(key, { point, owners: [routed] });
    }
    edges.push(routed);
  }
  return { mode: "graph", width, height, nodes, edges };
}
