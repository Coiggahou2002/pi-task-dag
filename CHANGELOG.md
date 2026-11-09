# Changelog

## 0.1.0-alpha.1

- Add a guarded fullscreen sidebar adapter for Pi 1.5.0 without changing installed source files.
- Fall back to a compact widget and `/dag` inspector on narrow, regular or unsupported layouts.
- Add session-scoped, branch-aware DAG state with cycle/revision/transition validation and reported completion evidence.
- Register `dag_plan`, `dag_update`, and `dag_get` for Agent-maintained progress.
- Add explicit temporary demo mode, node inspection, scrolling, and safe layout restoration.

Experimental: the sidebar reads a private host layout field; automatic independent planning and multi-agent execution are not included.
