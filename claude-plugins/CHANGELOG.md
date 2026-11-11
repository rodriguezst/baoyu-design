# Claude integration changelog

## 0.1.0

- Supply seven skill-only plugins from canonical upstream skills, with ZIPs generated under ignored `dist/`.
- Register one shared host stdio MCP exposing `open_artifact` and `stop_artifact` with absolute host artifact paths.
- Let Desktop start the bridge and upstream launchers start/reuse editor servers automatically.
- Keep authoring, validation, asset handling, and saved-comment reads/replies in Cowork's shared workspace.
- Preserve upstream skill/editor files unchanged; add a separate Cowork execution skill and host configuration printer.
- Exercise all six editors, saved-comment round trips, lifecycle/reconnects, browser writes, and packaging in integration tests.
- Document the real macOS/Cowork checks still required; automated filesystem aliases do not validate Desktop installation or VM behavior.
