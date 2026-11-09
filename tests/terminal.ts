import {
  Text,
  ScrollView,
  TuiAltScreen,
  VStack,
  type Terminal,
} from "@earendil-works/pi-tui";

export function terminalHarness(initialWidth = 140) {
  let columns = initialWidth;
  let input: (data: string) => void = () => {
    throw new Error("terminal not started");
  };
  let onResize: () => void = () => {};
  const copied: string[] = [];
  const terminal: Terminal = {
    get columns() {
      return columns;
    },
    rows: 24,
    kittyProtocolActive: false,
    start(handler, resize) {
      input = handler;
      onResize = resize;
    },
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copyOnSelect: true,
    async copySelection(text) {
      copied.push(text);
      return true;
    },
  });
  const transcript = new ScrollView(
    new Text("LEFT_TRANSCRIPT ".repeat(50), 0, 0),
    { primary: true, follow: "none" },
  );
  const dock = new VStack([new Text("> editor", 0, 0)]);
  const root = new VStack([
    { component: transcript, basis: 0, grow: 1 },
    { component: dock, grow: 0, shrink: 1 },
  ]);
  tui.setLayoutRoot(root);
  return {
    tui,
    root,
    copied,
    input(data: string) {
      input(data);
    },
    resize(width: number) {
      columns = width;
      onResize();
    },
  };
}
