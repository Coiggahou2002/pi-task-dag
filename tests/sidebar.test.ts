import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  Text,
  VStack,
  visibleWidth,
  stripTerminalSequences,
} from "@earendil-works/pi-tui";
import {
  SidebarAdapter,
  readLayoutRoot,
} from "../extensions/task-dag/sidebar.ts";
import { terminalHarness } from "./terminal.ts";

function fail(message: string): never {
  assert.fail(message);
}

test("actual fullscreen layout reserves 38 columns and restores the exact host root", async () => {
  const host = terminalHarness();
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    new Text("RIGHT_DAG", 0, 0),
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    assert.equal(adapter.visible, true);
    const lines = host.tui.getScreenLines();
    const first = stripTerminalSequences(lines[0] ?? "");
    assert.equal(first.indexOf("RIGHT_DAG"), 102);
    for (const line of lines) assert.ok(visibleWidth(line) <= 140);
    host.resize(100);
    adapter.sync();
    await delay(10);
    assert.equal(adapter.visible, false);
    assert.equal(readLayoutRoot(host.tui), host.root);
    assert.ok(
      host.tui.getScreenLines().every((line) => !line.includes("RIGHT_DAG")),
    );
    host.resize(140);
    adapter.sync();
    await delay(10);
    assert.equal(adapter.visible, true);
    adapter.dispose();
    adapter.dispose();
    assert.equal(readLayoutRoot(host.tui), host.root);
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});

test("unsupported versions/foreign layouts are not mutated, and warnings are not repeated", () => {
  const host = terminalHarness();
  const warnings: string[] = [];
  const unsupported = new SidebarAdapter(
    host.tui,
    "2.0.0",
    new Text("panel"),
    () => true,
    (message) => warnings.push(message),
  );
  unsupported.sync();
  unsupported.sync();
  assert.equal(readLayoutRoot(host.tui), host.root);
  assert.equal(warnings.length, 1);
  unsupported.dispose();
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    new Text("panel"),
    () => true,
    (message) => warnings.push(message),
  );
  adapter.sync();
  const foreign = new Text("another extension owns this layout");
  host.tui.setLayoutRoot(foreign);
  adapter.sync();
  adapter.dispose();
  assert.equal(readLayoutRoot(host.tui), foreign);
});

test("disposal hides an owned panel even if another layout has nested its wrapper", async () => {
  const host = terminalHarness();
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    new Text("RIGHT_DAG", 0, 0),
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    const wrapped = readLayoutRoot(host.tui);
    assert.ok(wrapped);
    const foreign = new VStack([{ component: wrapped, basis: 0, grow: 1 }]);
    host.tui.setLayoutRoot(foreign);
    adapter.dispose();
    await delay(10);
    assert.equal(readLayoutRoot(host.tui), foreign);
    assert.ok(
      host.tui.getScreenLines().every((line) => !line.includes("RIGHT_DAG")),
    );
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});

test("wheel scrolling stays in the sidebar without moving the chat transcript", async () => {
  const host = terminalHarness();
  const content = new Text(
    Array.from(
      { length: 50 },
      (_, index) => `NODE_${String(index).padStart(2, "0")}`,
    ).join("\n"),
    0,
    0,
  );
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    content,
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    const before = stripTerminalSequences(host.tui.getScreenLines()[0] ?? "");
    assert.match(before.slice(102), /NODE_00/);
    host.input("\x1b[<65;130;5M");
    await delay(10);
    const after = stripTerminalSequences(host.tui.getScreenLines()[0] ?? "");
    assert.notEqual(after.slice(102), before.slice(102));
    assert.equal(after.slice(0, 102), before.slice(0, 102));
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});

test("copying transcript selection does not include sidebar content", async () => {
  const host = terminalHarness();
  const adapter = new SidebarAdapter(
    host.tui,
    "1.5.0",
    new Text("RIGHT_DAG", 0, 0),
    () => true,
    fail,
  );
  try {
    host.tui.start();
    adapter.sync();
    await delay(10);
    host.input("\x1b[<0;2;1M");
    host.input("\x1b[<32;20;3M");
    host.input("\x1b[<0;20;3m");
    await delay(10);
    assert.ok(host.copied.length > 0);
    assert.match(host.copied.join(""), /TRANSCRIPT/);
    assert.doesNotMatch(host.copied.join(""), /RIGHT_DAG/);
  } finally {
    adapter.dispose();
    host.tui.stop();
  }
});
