import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import { parseState } from "../extensions/task-dag/state.ts";

function stateFrom(result: AgentToolResult<unknown>) {
  const first = result.content[0];
  assert.ok(first?.type === "text");
  const value: unknown = JSON.parse(first.text);
  return parseState(value);
}

test("real Pi loader/tool registry/session file: planning, updates, revision rejection and branch/resume", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-task-dag-test-"));
  try {
    const cwd = resolve(".");
    const path = resolve("extensions/task-dag/index.ts");
    const loaded = await discoverAndLoadExtensions([path], cwd, dir);
    assert.deepEqual(loaded.errors, []);
    const session = SessionManager.create(cwd, join(dir, "sessions"));
    session.appendMessage({
      role: "user",
      content: "完成一个有依赖的长任务",
      timestamp: Date.now(),
    });
    loaded.runtime.appendEntry = (type, data) => {
      session.appendCustomEntry(type, data);
    };
    const models = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(dir, "models.json"),
      refreshOnCreate: false,
    });
    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      session,
      new ModelRegistry(models),
    );
    const errors: string[] = [];
    runner.onError((error) => errors.push(error.error));
    await runner.emit({ type: "session_start", reason: "startup" });
    const create = runner.getToolDefinition("dag_plan");
    const change = runner.getToolDefinition("dag_update");
    const get = runner.getToolDefinition("dag_get");
    assert.ok(create);
    assert.ok(change);
    assert.ok(get);
    assert.equal(change.executionMode, "sequential");
    const signal = new AbortController().signal;
    const ctx = () => runner.createToolContext("test", signal);
    const created = await create.execute(
      "create",
      {
        expectedRevision: 0,
        title: "实现并测试",
        nodes: [
          { id: "A", title: "实现", dependsOn: [] },
          { id: "B", title: "测试", dependsOn: ["A"] },
        ],
      },
      signal,
      undefined,
      ctx(),
    );
    assert.equal(stateFrom(created).revision, 1);
    await assert.rejects(
      change.execute(
        "bad",
        { expectedRevision: 1, id: "B", action: "start" },
        signal,
        undefined,
        ctx(),
      ),
      /dependencies/,
    );
    await change.execute(
      "start",
      { expectedRevision: 1, id: "A", action: "start" },
      signal,
      undefined,
      ctx(),
    );
    await change.execute(
      "done",
      {
        expectedRevision: 2,
        id: "A",
        action: "complete",
        note: "实现已完成并审查",
      },
      signal,
      undefined,
      ctx(),
    );
    const checkpoint = session.getLeafId();
    assert.ok(checkpoint);
    await change.execute(
      "test",
      { expectedRevision: 3, id: "B", action: "start" },
      signal,
      undefined,
      ctx(),
    );
    await assert.rejects(
      change.execute(
        "stale",
        { expectedRevision: 3, id: "B", action: "complete", note: "测试" },
        signal,
        undefined,
        ctx(),
      ),
      /Stale/,
    );
    await runner.emit({ type: "agent_settled", aborted: true });
    const stopped = stateFrom(
      await get.execute("get", {}, signal, undefined, ctx()),
    );
    assert.equal(
      stopped.graph?.nodes.find((node) => node.id === "B")?.status,
      "running",
      "idle/abort never silently marks a task done",
    );
    const oldLeaf = session.getLeafId();
    assert.ok(oldLeaf);
    session.branch(checkpoint);
    await runner.emit({
      type: "session_tree",
      newLeafId: checkpoint,
      oldLeafId: oldLeaf,
    });
    const branched = stateFrom(
      await get.execute("get", {}, signal, undefined, ctx()),
    );
    assert.equal(branched.revision, 3);
    assert.equal(
      branched.graph?.nodes.find((node) => node.id === "B")?.status,
      "pending",
    );
    session.appendMessage({
      role: "user",
      content: "继续",
      timestamp: Date.now(),
    });
    const file = session.getSessionFile();
    assert.ok(file);
    await runner.emit({ type: "session_shutdown", reason: "resume" });
    const reopened = SessionManager.open(file);
    const nextLoaded = await discoverAndLoadExtensions([path], cwd, dir);
    assert.deepEqual(nextLoaded.errors, []);
    nextLoaded.runtime.appendEntry = (type, data) => {
      reopened.appendCustomEntry(type, data);
    };
    const resumed = new ExtensionRunner(
      nextLoaded.extensions,
      nextLoaded.runtime,
      cwd,
      reopened,
      new ModelRegistry(models),
    );
    resumed.onError((error) => errors.push(error.error));
    await resumed.emit({ type: "session_start", reason: "resume" });
    const nextGet = resumed.getToolDefinition("dag_get");
    assert.ok(nextGet);
    assert.deepEqual(
      stateFrom(
        await nextGet.execute(
          "get",
          {},
          signal,
          undefined,
          resumed.createToolContext("get", signal),
        ),
      ),
      branched,
    );
    await resumed.emit({ type: "session_shutdown", reason: "quit" });
    assert.deepEqual(errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
