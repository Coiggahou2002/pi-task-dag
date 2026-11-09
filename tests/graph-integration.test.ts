import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { DagPanel } from "../extensions/task-dag/panel.ts";
import { SidebarAdapter } from "../extensions/task-dag/sidebar.ts";
import { demoState, emptyState, plan } from "../extensions/task-dag/state.ts";
import { terminalHarness } from "./terminal.ts";

const theme: Pick<Theme, "fg" | "bold"> = {
  fg: (_color, text) => text,
  bold: (text) => text,
};
const fail = (message: string): never => assert.fail(message);

test("actual TUI renders the fork/join and routes a scrolled node click to its identity", async () => {
  const host = terminalHarness();
  const state = demoState();
  const inspected: string[] = [];
  const panel = new DagPanel(
    () => ({ state, demo: true, activeNode: "B" }),
    () => theme,
    (id) => inspected.push(id),
  );
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    panel,
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    const before = host.tui.getScreenLines().map(stripTerminalSequences);
    assert.match(before.map((line) => line.slice(102)).join("\n"), /▼/);
    assert.match(
      before.map((line) => line.slice(102)).join("\n"),
      /实现前端页面/,
    );
    for (let index = 0; index < 12; index++) host.input("\x1b[<65;130;5M");
    await delay(10);
    const after = host.tui.getScreenLines().map(stripTerminalSequences);
    assert.equal(after[0]?.slice(0, 102), before[0]?.slice(0, 102));
    const row = after.findIndex((line) => line.slice(102).includes("◇ E"));
    assert.ok(row >= 0);
    const line = after[row];
    assert.ok(line);
    const x = line.indexOf("◇ E") + 1;
    host.input(`\x1b[<0;${x};${row + 1}M`);
    host.input(`\x1b[<0;${x};${row + 1}m`);
    await delay(10);
    assert.deepEqual(inspected, ["E"]);
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});

test("actual SGR Shift+wheel reaches horizontal panning without scrolling either transcript", async () => {
  const host = terminalHarness();
  const state = plan(emptyState(), 0, "wide", [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `R${index}`,
      title: `任务 ${index}`,
      dependsOn: [],
    })),
    {
      id: "J",
      title: "汇合",
      dependsOn: Array.from({ length: 6 }, (_, index) => `R${index}`),
    },
  ]);
  const panel = new DagPanel(
    () => ({ state, demo: false, activeNode: undefined }),
    () => theme,
    () => {},
    () => adapter.requestRender(),
  );
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    panel,
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    const before = host.tui.getScreenLines().map(stripTerminalSequences);
    assert.match(before[3]?.slice(102) ?? "", /横向 1–36/);
    for (let index = 0; index < 3; index++) host.input("\x1b[<69;130;5M");
    await delay(10);
    const after = host.tui.getScreenLines().map(stripTerminalSequences);
    assert.match(after[3]?.slice(102) ?? "", /横向 13–48/);
    assert.equal(after[0]?.slice(0, 102), before[0]?.slice(0, 102));
    assert.match(after[0]?.slice(102) ?? "", /TASK DAG/);
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});
