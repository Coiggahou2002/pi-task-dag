# Changelog

## 0.2.0-alpha.1

- Replace layered text lists with a visual DAG: boxed nodes, orthogonal directed connectors, side-by-side branches and multi-parent joins.
- Use Dagre ordering and obstacle-aware A* routing; cache geometry separately from progress state.
- Add horizontal panning via `/dag left`, `/dag right`, Shift+wheel, and `/dag focus` to return to current work.
- Preserve independent vertical scrolling and accurately hit-test nodes after panning, scrolling and resizing.
- Mark unrelated crossings and explicitly fall back to dependency cards when routes would be ambiguous or exceed rendering limits.
- Preserve existing snapshots, tools, evidence rules and Pi compatibility guards; no state migration or Pi source changes.
- Add real TUI interaction tests, routing regressions and seeded graph stress coverage.

## 0.1.0-alpha.1

- Add a guarded fullscreen sidebar adapter for Pi 1.5.0 without changing installed source files.
- Fall back to a compact widget and `/dag` inspector on narrow, regular or unsupported layouts.
- Add session-scoped, branch-aware DAG state with cycle/revision/transition validation and reported completion evidence.
- Register `dag_plan`, `dag_update`, and `dag_get` for Agent-maintained progress.
- Add explicit temporary demo mode, node inspection, scrolling, and safe layout restoration.

Experimental: the sidebar reads a private host layout field; automatic independent planning and multi-agent execution are not included.
