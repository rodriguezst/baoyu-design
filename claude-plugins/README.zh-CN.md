# Claude 插件与共享宿主机编辑器

[English](README.md) · [简体中文](README.zh-CN.md)

这些插件直接复用上游技能。Claude 在 Cowork 的共享工作目录中生成和修改作品；单独注册的一份 **baoyu-editor MCP** 负责在宿主机打开现有编辑器。

**不需要用户提前启动服务器。** Claude Desktop 启动 MCP 的 Node 进程；Claude 调用 `open_artifact` 时，MCP 执行上游 `artifact.mjs open`，启动或复用宿主机编辑器服务器，再返回浏览器链接。

| 插件 | 上游技能 | MCP kind |
|---|---|---|
| `baoyu-slides` | `claude-slides` | `slides` |
| `baoyu-canvas` | `claude-design` | `design` |
| `baoyu-design-system` | `claude-design-system` | `design-system` |
| `baoyu-dashboard` | `claude-dashboard` | `dashboard` |
| `baoyu-motion` | `claude-motion`、`motion-director`、`dataviz` | `motion` |
| `baoyu-whiteboard` | `claude-whiteboard` | `whiteboard` |
| `baoyu-dataviz` | `dataviz` | 仅指导，无需 MCP |

## 环境要求

- 宿主机有包含本集成的本地仓库，以及 Node.js 22 或更高版本。
- Claude Desktop Cowork 支持安装、配置本地 stdio MCP。
- Cowork 执行环境和宿主机都能读写同一个工作目录。Claude 需要知道虚拟机路径对应的真实宿主机路径。
- Cowork 内能运行上游技能脚本。Motion 的可选渲染、录制和音频功能仍需要上游要求的 Chrome、ffmpeg 或语音服务；本 MCP 不会把这些命令移到宿主机执行。

这个方案要求共享目录，不通过 MCP 传输隔离云环境中的作品。使用本地工具和浏览器时保持 Desktop 开启。

## 在宿主机配置一次 MCP

在包含这些修改的仓库中，用自己的终端执行：

```bash
npm ci --prefix claude-plugins
npm run config --prefix claude-plugins --silent
```

第二条命令输出包含本机 Node、MCP 入口和仓库绝对路径的配置。把 `baoyu-editor` 合并到 Desktop 部署支持的本地 MCP 配置中。该命令只打印配置，不修改应用设置，也不启动服务器。

如果你的 Desktop 提供 **Settings → Developer → Edit Config**，把条目合并进已有的 `mcpServers`，不要覆盖其他服务器。标准 Desktop 和第三方推理（3P）部署的配置方式不同；受管理的 3P 部署可以通过 `managedMcpServers` 提供相同的启动命令和参数。参见官方[本地 MCP 安装说明](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)及 [3P 扩展说明](https://claude.com/docs/third-party/claude-desktop/extensions)。

按应用要求重启 Desktop，开启新的 Cowork 任务，确认能发现 `baoyu-editor` 的 `open_artifact` 和 `stop_artifact`。实际工具名可能带命名空间。技能加载成功不代表这份独立 MCP 已经连接。

六种编辑器共用一份 MCP。无需为各插件配置 MCP，无需公开 HTTP MCP 地址或安装常驻服务。Desktop 在连接时启动 stdio 进程，作品编辑器则按需启动。

## 在 Cowork 安装技能

生成插件 ZIP：

```bash
npm run pack --prefix claude-plugins
# 只打包需要的插件：
npm run pack --prefix claude-plugins -- baoyu-slides
```

通过 Desktop 的自定义插件上传功能，逐个上传 `claude-plugins/dist/` 中的 ZIP，并在 Cowork 启用。每个包包含清单、选中的上游技能及其支持文件、许可说明和简短的 `cowork-editor` 集成技能，不包含 MCP 服务器。上游文件逐字节复制，不在插件内部构建或安装依赖。

把存放作品的目录授权给 Cowork，然后在新任务中请求：

> 使用 claude-slides 在这个工作目录生成演示文稿，并在宿主机编辑器中打开。

Claude 用虚拟机路径写文件、运行上游命令，再用对应的**宿主机作品根目录绝对路径**调用 MCP。返回类似 `http://127.0.0.1:4710/slides/<id>/` 的链接；Desktop 浏览器允许时可直接打开，否则使用系统浏览器。双方修改的是同一组文件。

## Marketplace 与 Claude Code

仓库根目录的 `.claude-plugin/marketplace.json` 直接选择标准 `skills/`，不提交生成的技能副本。在 Claude Code 中使用本地仓库：

```text
/plugin marketplace add /absolute/path/to/baoyu-design
/plugin install baoyu-slides@baoyu-design
```

这些命令针对包含本修改的本地 checkout，不表示上游 GitHub 仓库已经发布此集成。发布自己的 fork 后可以改用其地址。

根目录来源与技能选择是 [Claude Code 文档](https://code.claude.com/docs/en/plugins-reference#marketplace-entries-and-the-manifest)描述的行为；Desktop/Cowork 是否支持需要在目标版本验证，不支持时使用完整 ZIP。根目录和插件均不声明 `.mcp.json`，因此安装多个技能插件不会注册多份宿主机 MCP。

Claude Code 可按其支持的 stdio MCP 方式注册同样的启动配置。如果希望直接在本地 shell 启动编辑器、不采用本集成的宿主机路由说明，可以安装上游独立技能。

## MCP 调用

两个工具都只接受 `path` 和 `kind`。`path` 是宿主机上已存在的作品根目录，里面包含 `project/` 或 `db/`，不是虚拟机路径，也不是子目录本身。

```json
{
  "path": "/Users/alex/work/demo/designs/q3-review",
  "kind": "slides"
}
```

`open_artifact` 返回解析后的宿主机路径、`kind`、实际 `url` 和 `reused`。端口、ID、路由和备用端口均复用上游行为。

`stop_artifact` 用相同参数卸载这个作品，返回 `stopped: true`，不会关闭同服务器上的其他作品。没有服务器记录时返回 `stopped: false`。无法验证的虚拟机或陈旧状态会报错，不会直接向记录中的 PID 发信号。MCP 断开后上游后台服务器可继续运行，重连后仍可调用停止工具。

工具不接受任意命令、脚本、CLI 参数或 URL；不需要工作目录注册表，也不会另建一份 `~/baoyu-design` 作品目录。

## 评论和功能边界

在宿主机编辑器评论后，在聊天中说 **“实现评论”**。Claude 在虚拟机用上游 `comments` 读取共享的 `comments.json`，修改作品，再用 `comment-reply` / `comment-resolve` 回复和解决。已保存评论、回复、上传、校验和数据库写入不需要虚拟机直接访问宿主机 HTTP 服务器。

初版不暴露实时 `comments --wait`、Send to Agent 自动唤醒和 Whiteboard 的实时 `context`。浏览器导出保持上游行为。Motion 的 CLI 渲染、录制和音频功能只在满足上游依赖和网络条件的环境中可用，不由这两个 MCP 工具代跑。

默认只启动宿主机编辑器。虚拟机服务器虽然可以读同样的评论，但两边会共用含 PID/URL 的 `.artifact-server.json`。不要用虚拟机启停命令处理宿主机状态；迁移前，已有虚拟机服务器应在其自身环境中停止。

## 排错与更新

- **找不到工具：**检查独立的 `baoyu-editor` 本地 MCP 连接和宿主机日志；会话提供工具发现时搜索延迟加载的工具。仅上传技能插件不会启动 MCP。
- **`INVALID_PATH` / `ARTIFACT_NOT_FOUND`：**使用 Desktop 提供的真实宿主机根目录；先在共享目录生成作品。
- **`RUNTIME_NOT_FOUND`：**检查 `--repo`，保留该 checkout 的上游脚本和编辑器文件。
- **`SERVER_STATE_CONFLICT`：**记录无法验证为该宿主机运行时，可能属于虚拟机、已停服务或另一份 checkout。检查日志，在对应环境处理已知服务器；MCP 不会删除或盲目信任这些状态。同一路径的已验证旧版宿主机服务可用 `stop_artifact` 停止后再打开。
- **`OPEN_FAILED`：**查看工具返回的上游错误；修正目录、作品格式或运行时后重试。工具会先验证宿主机 URL，Desktop 自身仍可能限制本地导航。
- **超时或取消：**上游后台服务可能已经启动；重新调用 `open_artifact` 复用它，需要关闭时显式调用停止工具。

更新前先停止宿主机编辑器。拉取或 rebase 后执行 `npm ci --prefix claude-plugins`，重新生成并安装插件，再重启 MCP 连接。虚拟机技能和宿主机运行时使用同一 checkout/版本；已启动进程不会自动热更新。

## 开发与验证

```bash
npm ci --prefix claude-plugins
npm run build --prefix claude-plugins
npm run check --prefix claude-plugins
npm test --prefix claude-plugins
npm run pack --prefix claude-plugins
```

测试覆盖实际 stdio 配置及符号链接启动、六种 HTTP 编辑器、共享文件、评论与回复、浏览器写回磁盘、复用、并发打开、单作品停止、重连、错误、取消/超时，以及 ZIP 与上游文件的字节一致性。生成文件仅写入忽略的 `dist/`；构建器只生成较小的 marketplace 元数据。

自动化路径别名测试不等同真实 Cowork 虚拟机。macOS/Desktop 上仍需验证 Cowork 中的 MCP 发现、宿主机路径、共享文件双向变化、集成指令的执行、本地浏览器导航和 marketplace 兼容性。生成 ZIP 不代表 Desktop 已接受上传。完整设计与人工验收步骤保留在 [PROPOSAL.md](PROPOSAL.md)。

## 许可

本地工具遵循仓库 [LICENSE](../LICENSE)。上游技能文字、参考资料、编辑器与第三方文件保留 [NOTICE.md](../NOTICE.md) 和各自声明中的条款。此集成不修改上游技能或编辑器源码。
