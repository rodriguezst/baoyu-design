---
name: cowork-editor
description: >-
  Use together with Baoyu's claude-slides, claude-design, claude-design-system,
  claude-dashboard, claude-motion, motion-director, or claude-whiteboard skills in
  Claude Desktop Cowork. Explains shared workspace authoring, opening or closing
  their host editors with the baoyu-editor MCP, and implementing saved comments.
---

# Cowork editor integration

These instructions adapt only execution locations and opening/closing editors.
Follow the original upstream skill for formats, design rules, authoring, uploads,
validation, and saved comments. Apply this execution guidance when its normal
instructions would start a server in Cowork's shell.

## Shared files and two paths

Keep the artifact under the workspace folder the user connected to Cowork. The
host and Cowork's VM must have read/write access to the same files. Use the VM
path for local file tools and upstream `artifact.mjs` commands. Use Desktop's real
absolute host path for MCP. The artifact root contains `project/` or `db/`; pass
that root, not the subdirectory. Do not guess that a `/mnt/...` VM path is a host
path, and do not create a second copy under a different host workspace.

Read installed skill references normally. Author files with normal file tools;
database-backed artifacts still use upstream `write-db` / `read-db`. Run upstream
`upload`, `check`, and other file operations locally against the shared files.
Copy inputs needed by the editor into the shared workspace first.

## Open the host editor

Instead of running upstream `open` or `serve` inside the VM, call the shared host
MCP's `open_artifact` with the absolute host artifact root and the matching kind:

| Skill | MCP kind |
|---|---|
| `claude-slides` | `slides` |
| `claude-design` | `design` |
| `claude-design-system` | `design-system` |
| `claude-dashboard` | `dashboard` |
| `claude-motion`, `motion-director` | `motion` |
| `claude-whiteboard` | `whiteboard` |

For example, `open_artifact({"path":"/Users/alex/work/demo/designs/review","kind":"slides"})`.
Discover the tool's actual namespace using tool search if the session provides
it. A loaded skill alone does not establish that the separately installed MCP is
connected. If it is unavailable, report that the shared `baoyu-editor` local MCP
must be installed/enabled; do not substitute a VM editor URL.

Desktop launches the MCP process. This tool starts or reuses the upstream host
editor automatically; the user need not start a server beforehand. Give the
returned URL as a clickable link and open it in the Desktop browser when
available and appropriate under the upstream skill. If app policy prevents local
navigation, the user can open the same URL in their system browser. Do not claim
to have displayed a page you have not opened.

Call `stop_artifact` with the same host root/kind to stop the host editor. Do not
run VM `stop` against host PIDs in shared `.artifact-server.json`. Keep these
runtime files managed by upstream. Report actual path/runtime/startup errors;
do not fix them by creating a VM server, enabling LAN sharing, or using a tunnel.

## Saved comments

When asked to implement comments, run upstream `comments <vm-root>` locally,
edit the shared artifact, validate it, then use `comment-reply` and
`comment-resolve` (or reply with `--resolve`). Comments are shared files; these
commands need no host HTTP connection and no MCP content transfer.

Use this manual saved-comment workflow in place of the upstream live-listener
instructions: do not start `comments --wait` or an agent hook, and do not promise
automatic Send to Agent chat wakeup. Live Whiteboard `context` and host-only
Motion render/audio operations are not exposed by this two-tool bridge. Existing
browser export controls keep their upstream behavior and requirements.
