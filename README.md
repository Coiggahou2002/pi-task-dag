# pi-task-dag (experimental)

A session-scoped task DAG with a **real reserved right-hand column**, without patching or forking Pi.

**Prototype, not a stable sidebar API.** Fullscreen sidebar support is deliberately restricted to the tested Earendil Pi **1.5.0** layout. Other versions, unknown/foreign layouts, regular mode, and narrow terminals use a compact row plus `/dag` inspection instead.

## Try it

Requires Node.js 22+ and Pi. Install this independent plugin:

```sh
pi install git:github.com/Coiggahou2002/pi-task-dag
```

Run `/reload`, make the terminal at least **120 columns** wide, then:

```text
/dag demo
/dag demo next
```

The demo is prominently labeled **演示图 · 非实际进度**, is temporary, does not call a model, does not persist fake progress, and never changes a real task graph. Each `demo next` completes the running/next-ready example node. `/dag demo off` returns to the real graph. A real graph mutation also exits demo mode.

For a one-invocation test without installing:

```sh
pi -e git:github.com/Coiggahou2002/pi-task-dag
```

## What the prototype does

- Reserves a **38-column** right pane in fullscreen mode, leaving at least 80 columns for the original chat/editor/footer. It is not an overlay over transcript text.
- Automatically collapses below 120 terminal columns and restores when widened. Hidden or empty graphs reserve no space.
- Shows topological layers, explicit prerequisite IDs, ready/blocked states, running/completed/waiting/failed nodes, and completed/total counts. Joins such as `D ← B + C` are explicit: this is not a misleading dependency tree.
- Supports sidebar mouse-wheel scrolling and clicking a node for full details. `/dag` provides keyboard-accessible selection/inspection. No routine focus stealing or custom keyboard protocol.
- Keeps one active graph per session branch, restored across reload/resume/fork and `/tree`.
- Rejects cycles, unknown/self/duplicate dependencies, duplicate task IDs, stale revisions and invalid state transitions.
- Requires a started node and a nonempty evidence note before completion; waits/failures require a reason. Evidence is **Agent-reported**, not independently verified by this plugin.
- Supports **one running task** per session in this prototype. DAG branches express dependency structure and potential parallelism, not an assertion that parallel workers have started.
- Marks persisted running work **待核对** after the agent settles or a session is restored. The agent must explicitly confirm continuation; stopping or resuming never silently completes a task.
- Reopening a completed node invalidates its transitive descendants as pending/recheck work, preserving unrelated completed nodes. Earlier snapshots remain in history.

### Agent integration

Three structured tools are registered:

| Tool         | Purpose                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `dag_plan`   | Create/replace a graph; every node starts pending. Supply `expectedRevision` (initially 0).                                   |
| `dag_update` | `start`, `complete`, `wait`, `fail`, or `reopen` one node with `expectedRevision`; completion/wait/failure requires a `note`. |
| `dag_get`    | Read the real graph and current revision; demo data is excluded.                                                              |

Tool guidance asks the agent to plan dependency-heavy work and update at meaningful execution boundaries. The current graph is included as a structured system-prompt section. Updates use sequential execution and optimistic revisions; stale changes fail rather than overwriting newer work. A graph replacement is intentional **reset/replanning**, not an incremental edit that preserves old statuses.

**There is not yet an independent automatic planner, a forced agent-continuation guard, an automatic scheduler, or multi-agent ownership.** This version proves the layout and structured state/update path. It does not infer completion from shell success or prose, invent progress if the agent forgets to update, or launch work because a node becomes ready. Ask the agent to use the DAG tools for a real long task.

## Commands

| Command                   | Action                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/dag` or `/dag view`     | Select a node and inspect full title, state, prerequisites, reason and reported evidence; editor changes are discarded |
| `/dag show` / `/dag hide` | Show/collapse the current graph                                                                                        |
| `/dag demo`               | Show the temporary example graph                                                                                       |
| `/dag demo next`          | Advance the example only                                                                                               |
| `/dag demo off`           | Return to the real graph                                                                                               |
| `/dag clear`              | Wait for the agent to settle, confirm, clear the real graph and exit demo mode; revisions remain monotonic             |
| `/dag help`               | Command help                                                                                                           |

Visibility resets to shown on a session start. Demo mode is cleared on reload or branch navigation. Real graphs are versioned custom Pi session entries (`pi-task-dag/state`), bounded to 32 nodes and 24 KiB per full snapshot. `--no-session` is not durable; a new session is only written to disk once a conversation message exists, following Pi's normal behavior.

## How the sidebar avoids changing Pi source

The approach was informed by [pi-atelier's split-pane implementation](https://github.com/michaelmjhhhh/pi-atelier/blob/main/src/split-pane.ts), but this smaller adapter does not copy its overlay, image or selection patches.

1. An ordinary zero-height widget supplies the TUI instance and normal extension disposal lifecycle.
2. On the tested fullscreen renderer, `sidebar.ts` **reads the private `layoutRoot` field** and verifies the known `VStack(primary ScrollView, input dock)` shape.
3. It uses existing `HStack`, non-primary `ScrollView` and public `setLayoutRoot()` to wrap that original root next to the DAG panel.
4. It never replaces TUI children, rendering/overlay/selection methods, or the editor. Disposal restores the exact original root **only if this adapter still owns the mounted root**. A foreign layout is not overwritten.
5. Width/mode reconciliation discovered during a frame is deferred until that frame finishes.

**The private root read is a compatibility risk.** Exact version and shape checks are intentional. There is no claim of official sidebar support or universal compatibility. When Pi updates, expect a safe fallback until the adapter has been tested against that release. Multiple sidebar/layout extensions are not composited together. Inline-image composition and every third-party editor/layout combination have not been verified.

No Pi installation files are edited, no terminal/tmux panes are spawned, and no background model/service/process is started. The only model work is the normal agent using registered tools; prompt/tool-result tokens still count as normal session usage. Do not place secrets in task labels or evidence. Extensions have the same OS permissions as Pi.

## Verification

```sh
npm ci
npm run check
npm test
pi -e ./extensions/task-dag/index.ts
```

Tests use the actual Pi TypeScript loader, tool registry, session files and fullscreen layout renderer. They cover DAG invariants, transition/revision failures, branch/disk restoration, column reservation, narrow-width restoration, foreign-layout/version refusal, sidebar scrolling, transcript-only selection/copy, and mouse detail dispatch.

Real Pi PTY checks cover 140→100→140-column resizing, input text preservation, node inspection, demo progress, hide/show, reload cleanup and regular-mode fallback. A real model also drove `dag_plan`/`dag_update` through a two-node, explicitly simulated acceptance run with project tools disabled. No claim is made about independently verifying Agent-reported evidence or visual glyph rendering in every terminal/font.

## Uninstall

```sh
pi remove git:github.com/Coiggahou2002/pi-task-dag
```

Then `/reload` or restart Pi. Historical DAG entries remain in session history but are no longer displayed or updated.

## License

MIT
