import {
  HStack,
  ScrollView,
  VStack,
  isViewportTUI,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

export const TESTED_PI_VERSION = "1.5.0";
export const PANEL_WIDTH = 38;
export const MIN_MAIN_WIDTH = 80;
export const MIN_TERMINAL_WIDTH = 120;

function component(value: unknown): value is Component {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function" &&
    "invalidate" in value &&
    typeof value.invalidate === "function"
  );
}

/** The single private seam. Never mutate TUI children, render, overlay or selection methods. */
export function readLayoutRoot(value: unknown): Component | undefined {
  if (typeof value !== "object" || value === null || !("layoutRoot" in value))
    return undefined;
  return component(value.layoutRoot) ? value.layoutRoot : undefined;
}

function knownHostRoot(root: Component | undefined): root is VStack {
  return (
    root instanceof VStack &&
    root.children.length === 2 &&
    root.children[0] instanceof ScrollView &&
    root.children[0].primary &&
    root.children[1] instanceof VStack
  );
}

/** Experimental adapter; source files are never changed. Unknown layouts fall back, not guessed. */
export class SidebarAdapter {
  private original: Component | undefined;
  private wrapped: HStack | undefined;
  private disposed = false;
  private scheduled = false;
  private warned = false;

  constructor(
    private readonly tui: TUI,
    private readonly version: string,
    private readonly panel: Component,
    private readonly enabled: () => boolean,
    private readonly warn: (message: string) => void,
  ) {}

  private wanted(): boolean {
    return (
      !this.disposed &&
      this.enabled() &&
      this.tui.mode === "fullscreen" &&
      this.tui.terminal.columns >= MIN_TERMINAL_WIDTH
    );
  }

  get visible(): boolean {
    return (
      this.wanted() &&
      this.wrapped !== undefined &&
      readLayoutRoot(this.tui) === this.wrapped
    );
  }

  private warning(): void {
    if (this.warned) return;
    this.warned = true;
    this.warn("DAG 原型未识别此 Pi 布局，已安全退回状态行和 /dag 查看。");
  }

  sync(): void {
    if (this.disposed) return;
    if (!this.wanted()) {
      this.detach();
      return;
    }
    if (this.version !== TESTED_PI_VERSION || !isViewportTUI(this.tui)) {
      this.warning();
      return;
    }
    const root = readLayoutRoot(this.tui);
    if (root === this.wrapped && this.wrapped) return;
    if (!knownHostRoot(root)) {
      this.warning();
      return;
    }
    this.original = root;
    const scroll = new ScrollView(this.panel, {
      primary: false,
      follow: "none",
      overscroll: "contain",
      scrollbar: "auto",
    });
    this.wrapped = new HStack([
      {
        component: root,
        basis: 0,
        grow: 1,
        shrink: 1,
        minSize: MIN_MAIN_WIDTH,
      },
      {
        component: scroll,
        basis: PANEL_WIDTH,
        grow: 0,
        shrink: 0,
        minSize: PANEL_WIDTH,
        maxSize: PANEL_WIDTH,
        visible: () => this.wanted(),
      },
    ]);
    this.tui.setLayoutRoot(this.wrapped);
    this.tui.requestRender();
  }

  /** Resize/mode checks discovered during render must wait until the frame is complete. */
  reconcileLater(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.sync();
    });
  }

  requestRender(): void {
    if (this.disposed) return;
    this.sync();
    this.panel.invalidate();
    this.tui.requestRender();
  }

  private detach(): void {
    if (
      this.wrapped &&
      this.original &&
      isViewportTUI(this.tui) &&
      readLayoutRoot(this.tui) === this.wrapped
    ) {
      this.tui.setLayoutRoot(this.original);
      this.tui.requestRender();
    }
    this.wrapped = undefined;
    this.original = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.tui.requestRender();
  }
}
