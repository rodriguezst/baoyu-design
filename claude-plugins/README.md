# Claude plugins and the shared host editor

[English](README.md) · [简体中文](README.zh-CN.md)

These skill-only plugins reuse the canonical upstream skills. Claude authors artifacts in Cowork's shared workspace, while one separately registered **baoyu-editor MCP** opens the existing editors on your computer.

**You do not start a server manually.** Claude Desktop starts the MCP's Node process. When Claude calls `open_artifact`, that process runs upstream's `artifact.mjs open`, starts or reuses the host editor server, and returns its browser URL.

| Plugin | Upstream skills | Editor kind |
|---|---|---|
| `baoyu-slides` | `claude-slides` | `slides` |
| `baoyu-canvas` | `claude-design` | `design` |
| `baoyu-design-system` | `claude-design-system` | `design-system` |
| `baoyu-dashboard` | `claude-dashboard` | `dashboard` |
| `baoyu-motion` | `claude-motion`, `motion-director`, `dataviz` | `motion` |
| `baoyu-whiteboard` | `claude-whiteboard` | `whiteboard` |
| `baoyu-dataviz` | `dataviz` | Guidance only; no MCP required |

## Requirements

- A local checkout containing this integration and Node.js 22+ on the host.
- Claude Desktop Cowork with a supported local stdio MCP installation/configuration mechanism.
- A workspace folder that Cowork's execution environment and the host can both read and write. Claude must know its actual host path as well as its VM mount path.
- The upstream skill's command dependencies inside Cowork. Motion's optional rendering, audio and recording features retain their own Chrome/ffmpeg/provider requirements; this bridge does not run those commands on the host.

This integration requires a shared folder. It does not transfer artifact files out of an isolated cloud-only workspace. Keep the Desktop app open while using its local tools and browser.

## Install once on the host

Run these commands in your own terminal, inside the checkout containing these changes:

```bash
npm ci --prefix claude-plugins
npm run config --prefix claude-plugins --silent
```

The second command prints the complete local MCP launch configuration with your absolute Node executable, MCP entry point, and repository path. Merge the `baoyu-editor` entry into your Desktop deployment's local MCP configuration. It prints configuration for review; it does not edit app settings or start a server.

For Desktop builds offering **Settings → Developer → Edit Config**, merge it into the existing `mcpServers` object rather than replacing other servers. Standard Desktop and third-party (3P) deployments have different configuration mechanisms. A managed 3P deployment may provision the same command/arguments through `managedMcpServers`. See Anthropic's [local MCP installation guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) and [3P extension documentation](https://claude.com/docs/third-party/claude-desktop/extensions).

Restart Desktop as required by its configuration mechanism, start a new Cowork task, and verify that it discovers `open_artifact` and `stop_artifact` from `baoyu-editor`. Callable tool names may include a namespace. A skill loading does not establish that its separately installed host MCP is connected.

There is one MCP for all six editors. There is no per-editor MCP configuration, public HTTP MCP endpoint, or always-running service to install. Desktop launches the stdio bridge when it connects; the bridge launches editor servers only when asked to open an artifact.

## Install skills in Cowork

Generate the plugin ZIPs:

```bash
npm run pack --prefix claude-plugins
# Or only the plugin you want:
npm run pack --prefix claude-plugins -- baoyu-slides
```

Upload individual ZIPs from `claude-plugins/dist/` using Desktop's custom plugin upload flow, then enable them in Cowork. Each ZIP contains its manifest, selected upstream skills and supporting files, applicable notices, and a small `cowork-editor` integration skill. It contains no MCP server. Upstream skill files are copied byte-for-byte; no build or package install is needed inside the uploaded plugin.

Grant Cowork access to your artifact workspace folder. Start a new task and ask, for example:

> Use claude-slides to make a presentation in this workspace, and open it in the host editor.

Claude writes the project using its normal file tools/upstream CLI in the VM, then passes the corresponding **absolute host artifact folder** to MCP. You get a link such as `http://127.0.0.1:4710/slides/<id>/`. Open it in Desktop's browser when allowed, or your system browser. Changes in the editor and in Cowork go into the same files.

## Marketplace and Claude Code

The root `.claude-plugin/marketplace.json` selects canonical `skills/` directories directly; no duplicated plugin skill trees are committed. In Claude Code, add this local checkout and install the desired names:

```text
/plugin marketplace add /absolute/path/to/baoyu-design
/plugin install baoyu-slides@baoyu-design
```

These are local-checkout instructions, not a claim that the upstream GitHub repository has published this fork's Claude integration. After publishing your fork, you can use its repository address instead.

Root-source selection is documented for [Claude Code](https://code.claude.com/docs/en/plugins-reference#marketplace-entries-and-the-manifest). Desktop/Cowork marketplace support must be checked in the target app; use the self-contained ZIP route if that format is not supported. Installing seven plugins from the repository must not automatically register seven host MCP processes: the root has no `.mcp.json`, and no plugin declares one.

For Claude Code, register the same host launch specification using its supported stdio MCP configuration. If you prefer local shell-based opening without this integration's routing instructions, install the standalone upstream skills instead.

## MCP calls

Both tools accept only `path` and `kind`. `path` is an existing absolute **host artifact root**, containing `project/` or `db/`; it is not a VM mount path, and not the subdirectory itself.

```json
{
  "path": "/Users/alex/work/demo/designs/q3-review",
  "kind": "slides"
}
```

`open_artifact` returns:

```json
{
  "path": "/Users/alex/work/demo/designs/q3-review",
  "kind": "slides",
  "url": "http://127.0.0.1:4710/slides/<upstream-id>/",
  "reused": false
}
```

`stop_artifact` with the same input unmounts that artifact and returns `stopped: true`; other projects in the upstream server remain open. With no recorded server it returns `stopped: false`. It refuses unverifiable process state instead of signalling a PID from the VM. Normal MCP disconnects leave upstream's detached editors open; reconnect and call `stop_artifact` when needed.

Ports, IDs, and routes come from upstream, including its fallback ports. The bridge uses a fixed trusted runtime mapping and never accepts custom commands, flags, script locations, or arbitrary URLs from tool calls. Host paths are resolved directly; there is no workspace registry or second `~/baoyu-design` artifact tree.

## Comments and feature boundaries

Leave comments in the host editor, then ask **“implement comments”**. Claude reads the shared `comments.json` using upstream's local `comments` command, changes the artifact, and uses `comment-reply` / `comment-resolve`. No network connection between the VM and host server is required for saved comments, replies, uploads, validation, or database writes.

Live `comments --wait` / automatic Send to Agent wakeup and Whiteboard's live `context` query are not exposed by this two-tool bridge. Browser export controls retain upstream behavior. Motion's CLI rendering/recording/audio features work only where their upstream dependencies and networking work; they are not moved to the host by this integration.

Use only the host editor server by default. A VM server can read the same comments, but upstream shares `.artifact-server.json` and its PID/URL state between the two environments. Do not start or stop that second server as a workaround for missing host tools. Existing manually started VM servers should be stopped in their own environment before adopting this lifecycle.

## Troubleshooting and updates

- **Missing tools:** verify the separately registered `baoyu-editor` connection and host logs. Search for deferred tool names if Cowork provides tool discovery. An uploaded skill plugin alone does not launch this MCP.
- **`ARTIFACT_NOT_FOUND` / `INVALID_PATH`:** pass Desktop's actual host artifact path. The VM path may name the same bytes differently. Create the artifact in the connected shared workspace first.
- **`RUNTIME_NOT_FOUND`:** check `--repo` and keep the canonical skill scripts/editors in that checkout. Keep the checkout available while editors run.
- **`SERVER_STATE_CONFLICT`:** the shared metadata cannot be verified as this host runtime; it may belong to a VM, stopped server, or another checkout. Inspect the host logs and stop known servers in their own environment. The bridge leaves this state alone. For a verified host server from an older build of the same runtime path, `stop_artifact` can stop it before reopening with the current files.
- **`OPEN_FAILED`:** the returned tool error includes the upstream cause. Correct the artifact/runtime error and retry. The bridge uses the real host URL and verifies it before reporting success; app browser policies can still require opening it in your system browser.
- **`STARTUP_TIMEOUT` / cancellation:** a detached upstream server may already have started. Retry `open_artifact`; it will reuse a working server. Explicitly stop it when finished.

Before updating the host checkout, stop its open editors. Pull/rebase, run `npm ci --prefix claude-plugins`, regenerate/reinstall the uploaded plugins, and restart the MCP connection. Update VM skills and host runtime from the same checkout/release. Already running upstream processes do not hot-reload new runtime code.

## Development and validation

```bash
npm ci --prefix claude-plugins
npm run build --prefix claude-plugins
npm run check --prefix claude-plugins
npm test --prefix claude-plugins
npm run pack --prefix claude-plugins
```

The tests exercise the stdio launch configuration through a cache symlink, all six HTTP editors, shared filesystem reads/writes, saved comments and replies, browser writes back to disk, reuse, concurrent opens, stopping one project while another remains open, reconnects, startup errors, cancellation/deadlines, and ZIP byte equality with upstream skill files. All generated archives remain in ignored `dist/`; the builder writes only the small marketplace metadata.

The automated path-alias test is not a real Cowork VM. Actual macOS/Desktop verification still needs local MCP discovery in Cowork, correct host path availability, bidirectional shared-folder updates, normal-request integration-skill routing, browser navigation policy, and Desktop marketplace compatibility. ZIP generation does not prove Desktop accepted an upload. The original [proposal](PROPOSAL.md) records the design and manual acceptance sequence.

## Terms

The maintainer's local tooling uses the repository's [LICENSE](../LICENSE). Upstream skill text, references, editors and vendor files retain their existing terms in [NOTICE.md](../NOTICE.md) and their bundled notices. No upstream editor or canonical skill source is modified by this integration.
