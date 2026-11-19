# DSH-Claude Code CLI

把本机的 `claude` CLI 变成 **DeepSeek Harness（DSH）** 里的图形化工作台：不用终端、不用手改
`settings.json`、不会丢会话。它把真实的 `claude` CLI 当作子进程驱动，所以 CLI 的每个参数、
`settings.json` 的每个键都照常生效；模型走你在 DSH 里**已经配置好的任意模型**，本地或云端都行。

[English](README.md) · **简体中文**

- 35 项设置，全部由 CLI 自身的参数与 `settings.json` 键生成
- 面板内完成工具审批 —— 同一 Wi-Fi 下也可以在手机上批
- 附件、实时思考链/工具链、会话历史（归档、回收站、批量操作）
- DSH 里已有的每个模型都出现在输入框的模型选择器里
- 一键升级 CLI：真查 npm registry，并按你的**真实安装形态**执行
- 中英双语界面，设置里随时切换

---

## 目录

- [为什么不直接用终端](#为什么不直接用终端)
- [工作原理](#工作原理)
- [你需要什么](#你需要什么)
- [安装](#安装)
- [使用](#使用)
- [工具审批](#工具审批)
- [升级 Claude CLI](#升级-claude-cli)
- [手机同 Wi-Fi 访问](#手机同-wifi-访问)
- [设置](#设置)
- [安全模型](#安全模型)
- [排障](#排障)
- [仓库结构](#仓库结构)
- [验收](#验收)
- [授权与商标](#授权与商标)

---

## 为什么不直接用终端

CLI 本身很好，本插件**不重写**它。插件补的是终端给不了的那部分：

| | 终端 | 本插件 |
| :- | :- | :- |
| 每个 CLI 参数 | 每次手敲 | 一个 schema 驱动的设置页，记住 |
| `settings.json` 键 | 手改 JSON | 按官方键名生成，用 `--settings` 注入 |
| 工具审批 | 在提示符敲 `y`/`a`/`n` | 面板里的审批卡，或手机上批 |
| 思考与工具调用 | 与正文混在一起 | 可折叠的时间线，按状态配图标 |
| 会话 | `--resume` 加记忆 | 列表 + 重命名/置顶/归档/恢复/彻底删除 |
| 附件 | 粘贴路径 | 拖进来，自动变成 CLI 能读的 `@path` |
| 切模型 | 改环境变量再重启 | 输入框里的选择器 |
| 升级 | npm 加运气 | 按钮，带真实版本差与 npm 日志 |

## 工作原理

```
┌──────────────────────────────────┐
│ DeepSeek Harness (DSH)           │
│  ┌────────────────────────────┐  │
│  │ Claude Code Desktop 面板   │  │   lib/client.js（slots：侧栏 + 主区）
│  └───────────┬────────────────┘  │
│              │ HTTP              │
│  ┌───────────▼────────────────┐  │
│  │ lib/index.js               │  │   ctx.webServer.register()，30+ 路由
│  └───────────┬────────────────┘  │
└──────────────┼───────────────────┘
               │ 每轮起一个子进程
      ┌────────▼─────────┐
      │ claude CLI       │   -p --output-format stream-json --settings <运行时文件>
      └────────┬─────────┘
               │ ANTHROPIC_BASE_URL=http://127.0.0.1:<bridge>
      ┌────────▼─────────┐
      │ 本地协议桥       │   Anthropic 线格式  ⇄  DSH ctx.llm.stream()
      └────────┬─────────┘
               │
      ┌────────▼─────────┐
      │ 你的 DSH 模型    │   DeepSeek、网关、本地 Qwen、任何已登录的模型
      └──────────────────┘
```

三点必须知道：

1. **不需要 Anthropic 账号。** CLI 被 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_MODEL` 指向协议桥，
   除非你选的模型本身就是 Anthropic 的，否则它永远不访问 Anthropic。
2. **一轮一个进程。** MCP server 与后台 bash 每轮重建。这是成本，也是本插件不复刻长连接
   MCP 的原因。
3. **桥同时说两种线格式。** CLI 说 Anthropic，其它提供方基本说 OpenAI，桥每轮转换一次，
   含工具调用。

## 你需要什么

| | |
| :- | :- |
| 系统 | Windows 10 1809+（已实测）。macOS / Linux 理论上可用（插件是纯 Node），但未实测。 |
| DSH | **0.2.2-rc.3 或更新**（自带 Node ≥ 24.9） |
| Claude Code CLI | 任意较新版本 —— 只要二进制，不需要登录 |
| 模型 | DSH 里至少已配置一个 |
| 网络 | 安装与检查更新时需要；之后除非模型在远端，否则不需要 |

## 安装

### 第 1 步 —— 装 Claude Code CLI

本插件**不附带** Claude Code 二进制。它找你已装的那个来跑，所以先装 CLI。

**Windows，原生安装器（推荐，不需要 Node）：**

```powershell
irm https://claude.ai/install.ps1 | iex
```

**Windows，npm（Node 22 或更新；不要用 `sudo`）：**

```powershell
npm install -g @anthropic-ai/claude-code@latest
```

**macOS / Linux：**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

已经装了就用 `claude --version` 确认。插件也支持在**设置 → 高级 → claude CLI 路径**里显式指定
路径 —— 当 CLI 装在项目本地 `node_modules`（打包安装的常见形态）时，就用这个字段。

### 第 2 步 —— 把插件装进 DSH

本插件是标准 DSH 包。link 进某个 profile，并把它加进该 profile 的 bundle 列表：

```bash
cd ~/.dsh/profiles/<profile>
npm install "link:<本仓库路径>"
```

然后在 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里加上
`"@local/dsh-claude-code-cli"`，重启 DSH。

桌面端的 `<profile>` 是 `desktop`。注意 `desktop` 归 Electron 进程独占，**不能**由 CLI 启动
—— 这是设计如此，插件在起手机访问实例时会自动改用 `web` profile（bundle 集合相同）。

### 第 3 步 —— 选模型

DSH → 侧栏 → **Claude Code Desktop** → **设置 → 模型**，选一个 DSH 已有的模型，发消息。

## 使用

| 区域 | 内容 |
| :- | :- |
| 输入区 | 模型选择器（右下角）、权限模式、工作区选择、附件、任意格式粘贴 |
| 每条回复 | 模型名、时间、生成速度、缓存命中率、复制、在新会话中分支 |
| 上下文 | 输入框下方的环形进度，数据来自 CLI 自己的 `modelUsage` |
| 历史 | 重命名、置顶、归档、恢复、彻底删除、批量操作、复制 ID、分组 |
| 思考 | 可折叠时间线，与正文用颜色深浅区分，每步带状态图标 |

诊断接口：`GET /api/claude-code-parity/health`（桥端口、CLI 路径、版本），
以及 `/cli`、`/models`、`/upgrade/status`。

## 工具审批

CLI 以 `--permission-prompt-tool mcp__ccp-approval__approve` 启动，并带一份生成的
`mcp-config.json` 指向 `lib/approval-mcp.js`。模型想执行的每个工具都会在面板里变成一张卡：
**允许一次** / **始终允许** / **拒绝**。

- 超时默认 120 秒（可在设置里改，10–600 秒），超时即拒绝。
- **设置 → 工具与权限**可把只读族（`Read`、`Glob`、`Grep`、`WebFetch`、`WebSearch`、
  `NotebookRead`、`TodoWrite`）设为自动批准。
- 权限模式原样透传成 `--permission-mode`，`acceptEdits`、`plan`、`bypassPermissions`
  的行为与 CLI 完全一致。

## 升级 Claude CLI

**设置 → 高级 → 升级 Claude CLI** 做三件真事：

1. 从 CLI 自己的 `package.json` 读已安装版本（读不到则回退 `claude --version`），再请求
   `https://registry.npmjs.org/@anthropic-ai/claude-code/latest`，按语义化版本比对。
   没有任何硬编码字符串。
2. 从二进制路径逐级上溯到 `node_modules/@anthropic-ai/claude-code`，判断**安装形态**：
   项目本地安装就在它自己的根目录升级，只有真正的全局安装才加 `-g`。
3. 把 npm 的 stdout/stderr 逐行写进 `upgrade-state.json`，并报告 `旧版本 → 新版本`
   以及是否真的发生了变化。

> 这一点很关键：对项目本地安装执行 `npm update -g @anthropic-ai/claude-code` 是**静默无效**的
> —— 「点了更新没反应」的真实原因就在这里。插件先判断安装形态，再决定命令。

## 手机同 Wi-Fi 访问

**设置 → 手机访问**会列出本机真实的 LAN IPv4 网卡。选一个、点**启动**，插件会：

- 起一个绑定到该 LAN 地址的 DSH web 实例（`--host <LAN-IP> --trusted-host <host:port>`）
  —— DSH **拒绝** `0.0.0.0`，必须给具体字面量；
- 从该实例的 stdout 解析出带 token 的地址；
- 在 `端口+1` 上开一个**短地址跳转**，于是手机上只需输入 `http://192.168.1.103:9241`，
  不用敲带 token 的长地址。

手机拿到的是完整 DSH 界面（含本插件），会话数据与桌面端共享。点**停止**会同时关掉实例与跳转。

## 设置

六组共 35 项，每一项都接进了运行链路，全量往返由验收脚本覆盖。

| 分组 | 项目（schema 键名） |
| :- | :- |
| 常规（6） | `default_cwd`、`permission_mode`、`permission_prompts`、`timeout`、`tool_policy`、`language` |
| 外观（5） | `theme`、`show_thinking`、`show_tool_output`、`transcript_view`、`stream_speed` |
| 工具与权限（7） | `allow_read`、`allow_write`、`allow_bash`、`allow_glob`、`allow_web`、`approval_timeout`、`auto_approve_readonly` |
| 模型（6） | `model`、`provider`、`reasoning_effort`、`max_tokens`、`temperature`、`vision_mode` |
| 会话（5） | `auto_title`、`keep_history`、`history_limit`、`paste_doc_limit`、`export_format` |
| 高级（6） | `system_prompt`、`append_identity`、`strip_images_on_error`、`debug`、`cli_path`、`extra_flags` |

逐项说明与默认值见 [docs/configuration.md](docs/configuration.md)。

`推理强度` 默认 `auto`，含义是「不下发该参数」。把某个档位下发给不支持它的模型会让整轮失败，
所以 `auto` 是安全默认值；旧配置会按 `settings_version` 一次性迁移过来。

## 安全模型

- 协议桥只监听 **loopback**，并要求固定请求头 `x-api-key: cc-bridge`。
- DSH web 访问用一次性 launch token 换取 `HttpOnly` + `SameSite=Strict` 的 cookie，
  token 每次进程启动重新生成。
- 手机访问必须由你手动点**启动**；短地址只做 302 跳转，自身不提供任何内容。
- 凭据永不进入本仓库。插件只使用 DSH 已完成的鉴权，并原样透传提供方错误。

## 排障

| 现象 | 原因 | 处理 |
| :- | :- | :- |
| 面板空白但接口正常 | `__ModuleLoader__.load({id})` 与 `package.json` 的 `name` 不一致 | 两者必须逐字相同 |
| 第二轮必失败 | assistant 消息缺 `source` 字段 | 2.5.1 已修；确认不是旧构建 |
| `does not support reasoning effort "medium"` | 把档位下发给了不支持的模型 | 推理强度改回 `auto` |
| `message content cannot be empty` | 仅含工具结果的 user 消息 | 2.5.1 已修；2.5.2 起不再需要占位文本（这类消息直接不发送） |
| `profile "desktop" is managed exclusively by the Electron application` | CLI 不能起桌面 profile | 用 `web` profile |
| 点更新提示版本未变化 | CLI 是项目本地安装，`-g` 改不到 | 已修；插件会先判断安装形态 |
| 插件卡片显示旧名字 | 卡片读的是 `locale/<lang>.json` 的 `meta.title` | 改 locale 后重启 |
| 所有工具都返回 `No result provided` | 工具结果被塞进 user 消息的 parts，DSH 只读 text/image | 2.5.2 已修 —— 结果走独立 `role:'tool'` 消息 |
| 翻看历史时被拽回底部 | 自动跟随按「有新输出」而非「已在底部」判断 | 2.5.2 已修；右上角圆形箭头可一键回底 |
| 推理模型只有思考没有回复 | `blocks` 被合并进流式 thinking 行 | 2.5.2 已修，见知识库 ㉚ |
| 思考过程全部想完才一次性出现 | CLI 没要增量、前端整批追加、渲染又把内容压成一行 | 2.5.3 已修 —— `--include-partial-messages` + 打字泵 + 流式时自动展开，见 ㉝ |
| 更新后界面还是老样子 / 修了却「依然不行」 | 桌面端进程在文件修改前就启动了，加载的是旧代码 | 2.5.3 起面板顶部会直接提示「当前运行的是旧代码」；关闭窗口不算退出，需真正结束进程 |
| `dsh: fatal load failure: EPERM ... rename` | 两个实例共用 `~/.dsh/ccp-data`，同时 rename 同一个 job 文件 | 2.5.3 已修 —— 写入重试且不再升级为 unhandledRejection，见 ㉞ |
| 发图片附件报 `Cannot read properties of undefined (reading 'attachmentId')` / `Claude Code error` | Anthropic 图片块带的是 `source`，DSH 要求的是持久化 `attachment` 引用 | 2.5.4 已修 —— 图片先经 `ctx.get('attachments')` 落库再换成引用，见 ㉟ |
| 长的思考过程只显示一半 | 展开内容被截断到 8000 字，打字泵又封顶 400 字/秒 | 2.5.5 已修 —— 完整渲染，打字速度随积压自动提升，见 ㊱ |
| 刚发的指令，模型一开始思考就没了 | 多个后台保存交错，旧快照最后落盘、写回了更短的消息列表 | 2.5.6 已修 —— 保存带单调递增版本号，旧版本写入被拒绝，见 ㊲ |
| 报 `exceed_context_size_error` / `request (131770 tokens) exceeds the available context size` | `--resume` 会重放完整 transcript；中文长会话超过本地模型 131k 窗口，而 CLI 默认压缩阈值跟随目录里上报的 1M 上下文 | 2.5.7 已修 —— `--autocompact 100000` + 协议桥中文感知硬预算裁剪 + 可操作中文提示；可调 `设置 → 会话 → 自动压缩阈值（Token）` |
| 带工具调用的轮次里，思考过程中途停住不显示 | 打字泵把排在工具标记**后面**的文本也算进 backlog，导致队首的标记永远释放不了，后面的思考也到不了 | 2.5.8 已修 —— 队首标记立即释放，backlog 只算最前面连续文本段；见 ㊴ |
| 思考过程里往上滚看开头，马上又被拽回底部 | 思考详情框在每个新字符到来时强制 `scrollTop = scrollHeight` | 2.5.9 已修 —— 只在已贴底时跟随，否则显示 ↓ 回到底部按钮；见 ㊵ |

更多带根因与证据的记录见 [docs/architecture.md](docs/architecture.md)。

## 仓库结构

```
├── package.json                 DSH 清单（dsh.bundle.patch + dsh.client.inject）
├── patches/bundle.yaml          loader patch —— 配置默认值
├── icon.svg  locale/{en,zh}.json
├── lib/
│   ├── index.js                 Host：路由、job 管理、CLI 子进程、升级、手机访问
│   ├── client.js                Client：侧栏 + 主面板（单文件 React）
│   ├── bridge.js                Anthropic ⇄ DSH LLM 协议桥
│   ├── approval-mcp.js          供 claude CLI 调用的审批 MCP server
│   └── common.js                持久化、设置 schema、CLI 历史扫描
├── docs/                        架构、配置、手机访问、发布
├── integrations/claude-code/    Claude Code 插件包装（市场条目）
├── tools/verify/                CDP + HTTP 验收脚本
└── .claude-plugin/              市场清单
```

## 验收

本仓库里没有任何未经实测的结论。`tools/verify/` 驱动真实的 DSH 实例和真实的无头 Chrome：

```bash
# 起隔离实例（记下它打印的 token）
dsh --profile <verify-profile> --port 39120 --host 127.0.0.1 --no-open

node tools/verify/_verify_all.mjs      "<token>"   # 21 项后端断言
node tools/verify/_verify_ui.mjs       "<token>"   # 9 项真实浏览器断言
node tools/verify/_verify_chat.mjs     "<token>"   # 经 CLI + 协议桥的两轮真实对话
node tools/verify/_verify_reply_unit.mjs            # 15 项事件合并断言（无需实例）
node tools/verify/_verify_reply_ui.mjs "<token>"   # 13 项：正文必须真的画出来
node tools/verify/_verify_reply_history.mjs "<token>"  # 15 项：坏记录可恢复
node tools/verify/_verify_scroll_ui.mjs "<token>"  # 22 项：滚动位置不被拽走 + 箭头
node tools/verify/_verify_tool.mjs     "<token>"   # 13 项：模型必须读到真实工具输出
node tools/verify/_verify_image.mjs    "<token>"   # 8 项：发图片不再让本轮失败
node tools/verify/_verify_thinking_full.mjs "<token>" # 7 项：长思考链完整显示
node tools/verify/_verify_split_ui.mjs "<token>"   # 12 项：分栏 + Start 面板
node tools/verify/_verify_send_ui.mjs  "<token>"   # 6 项：40MB 附件往返
node tools/verify/_verify_mobile_port.mjs "<token>" 9260  # 9 项：端口让位
node tools/verify/_verify_typing_ui.mjs "<token>"   # 18 项：思考链必须逐字出现
node tools/verify/_verify_save_guard.mjs "<token>"  # 5 项：旧的保存写入被拒绝
node tools/verify/_verify_usermsg_persist.mjs "<token>" # 9 项：发出的消息在后续轮次仍在
node tools/verify/_verify_context_overflow.mjs "<token>" # 16 项：自动压缩参数、历史裁剪、错误中文化
node tools/verify/_verify_title_stable.mjs "<token>"   # 9 项：稳定主题名、手动重命名锁定
node tools/verify/_verify_pump_interleave.mjs           # 8 项：工具调用不会再冻结思考显示
node tools/verify/_verify_thinking_scroll.mjs            # 9 项：翻看思考开头时位置不被拽走
```

2.5.9 基线：**21/21**、**9/9**、**15/15**、**13/13**、**15/15**、**22/22**、**12/12**、
**12/12**、**6/6**、**9/9**、**13/13**、**18/18**、**8/8**（图片）、**10/10**（长思考链）、
**5/5**（保存保护）、**9/9**（消息留存）、**16/16**（上下文溢出）、**9/9**（标题）、**8/8**（打字泵交错）、**9/9**（思考框滚动），
以及同一会话内的两轮对话。滚动检查在全量套件中曾因浏览器时序偶发 18/22，单独重跑为 22/22。

逐字验证每 200ms 采样一次真实 DOM：一次性渲染最多只会有「0 → 全长」一步，所以要求出现大量
不同的中间长度（实测思考链 0→928 字之间有 95 个中间值，正文 0→446 字之间有 36 个）。
对话脚本会临时固定一个可用文本模型，验完还原你原来的选择，不会把你的模型选择器改走。

## 授权与商标

MIT —— 见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。**Claude** 与 **Claude Code** 是
Anthropic, PBC 的商标。本项目是面向本地已安装 CLI 的独立前端，与 Anthropic 无隶属或背书关系。
**DeepSeek Harness** 是 DeepSeek 的产品，本插件是面向该宿主的第三方插件。
