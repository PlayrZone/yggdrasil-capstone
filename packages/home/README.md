# @yggdrasil/home

The shared lab home — one implementation of `~/.yggdrasil-lab` (override with
`YGG_HOME`) for both the Electron lab and the MCP server: the path layout, the
append-only activity feed (write, tail, rotate), and the shared Markdown
reports. Node built-ins only, so Electron's main process can bundle it without
pulling in `node:sqlite` via `@yggdrasil/db`.
