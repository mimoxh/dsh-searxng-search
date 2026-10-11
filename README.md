# dsh-searxng-search

[![test](https://github.com/mimoxh/dsh-searxng-search/actions/workflows/ci.yml/badge.svg)](https://github.com/mimoxh/dsh-searxng-search/actions/workflows/ci.yml)
[![dsh-vet](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmimoxh%2Fdsh-searxng-search%2Fdsh-vet%2Freport%2F.dsh-vet%2Fbadge.json)](https://github.com/mimoxh/dsh-searxng-search/blob/dsh-vet/report/.dsh-vet/report.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node >= 20.3.0](https://img.shields.io/badge/node-%3E%3D20.3.0-brightgreen.svg)

让 DSH 内置的 `web_search` 工具改走 [SearXNG](https://docs.searxng.org/)，替代随 DSH 一起提供的 DeepSeek 搜索通道。适合自建/内网 SearXNG 的场景。

- **零依赖**：只用 Node 全局 `fetch` / `URL` / `AbortSignal`，不 import 任何包，无构建步骤。
- **不改工具契约**：复用 DSH 的 web 能力 seam（`ctx.web`），模型侧仍然是原来的 `web_search` 工具，参数、结果卡片、引用格式全部不变。
- **不影响 `web_fetch`**：抓取 URL 仍由随附的 `dsh-web-fetch-http` 提供。
- **不绑定 surface**：代码只注册 seam，桌面端与 `dsh web` / `dsh tui` / `dsh headless` 都能用；装进哪个 profile，就只有那个 surface 生效，见 [3. 安装](#3-安装) 的方式 E / F。
- **可审计**：`package.json` 声明 `dsh.seams: ["web"]`，自测锁定它与 `inject` 一致；`dsh-vet` 在每次 push / PR 上审计，并把报告与等级公示在 `dsh-vet/report` 分支，见 [5. 验证](#5-验证)。
- **离线自测**：17 项检查（`npm test`），不需要网络、不需要安装依赖，其中一项专门拒绝带 UTF-8 BOM 的发布文件。

> **免责声明**：这是第三方项目，与 DeepSeek 官方无关，也不代表官方背书。
> DSH 目前是 **developer preview**，本插件针对 `0.2.0-rc.2` 验证过；它依赖的 seam
> API（`ctx.web.registerSearchProvider`）可能随 DSH 版本变化。

## 兼容性

| 项 | 要求 |
|---|---|
| DSH | `0.2.0-rc.2`（已验证）；`package.json` 的 `peerDependencies` 声明为 `^0.2.0-rc.2` |
| Node | **>= 20.3.0** —— 用到 `AbortSignal.any()`（Node 20.3.0 引入），CI 在 20.3 / 22 / 24 上验证 |
| 运行依赖 | 无 |
| 构建步骤 | 无 |

## 目录

- [1. 原理](#1-原理)
- [2. SearXNG 侧的准备](#2-searxng-侧的准备)
- [3. 安装](#3-安装)
- [4. 配置项](#4-配置项)
- [5. 验证](#5-验证)
- [6. 排错](#6-排错)
- [7. 已知的 DSH 侧问题](#7-已知的-dsh-侧问题)
- [8. 备选方案：MCP](#8-备选方案mcp)
- [9. 开发与测试](#9-开发与测试)

---

## 1. 原理

DSH 的 web 访问是一个可插拔的 **seam**（`@deepseek-ai/dsh-web`，即 `ctx.web`）：

| 组件 | 角色 |
|---|---|
| `@deepseek-ai/dsh-tool-web` | 面向模型的 `web_search` / `web_fetch` 工具 |
| `@deepseek-ai/dsh-web` | seam 本身：注册搜索/抓取提供方，并按 id 选择提供方 |
| `@deepseek-ai/dsh-web-search-deepseek` | 随附的搜索提供方（id：`deepseek-official`） |
| `@deepseek-ai/dsh-web-fetch-http` | 随附的抓取提供方（id：`http`） |

`dsh-base` 的默认配置把 seam 固定到了 `searchProvider: deepseek-official`。DSH **没有内置 SearXNG 提供方**，所以接入只需要两件事：

1. 挂载一个注册 `searxng` 搜索提供方的小插件（本组合包）；
2. 把 `web` 行的 `searchProvider` 改成 `searxng`。

这两件事都在本包的 `cordis.patch.yml` 里完成（组合包 patch 层在 `dsh-base` / `dsh-web-app` 之后应用，**同一行最后写入者生效**，因此可以覆盖默认值）。

> ⚠️ **必须显式固定 `searchProvider`**：`deepseek-official` 只要存在 `resolveApiKey`
> 解析器就报告「可用」，所以如果两个提供方同时可用，`web_search` 会以
> `WEB_PROVIDER_AMBIGUOUS` 失败。本包的 patch 已经替你固定好了。

---

## 2. SearXNG 侧的准备

这一步最容易踩坑，装了插件却搜不出结果，九成问题在这里。

### 2.1 打开 JSON API（最常见的坑）

SearXNG 默认只输出 HTML。在你的 `settings.yml` 里加上 `json`：

```yaml
search:
  formats:
    - html
    - json
```

改完**重启 SearXNG**。

**没开 JSON 时，SearXNG 对 `format=json` 返回 HTTP 403**（同一个地址用 HTML 搜索却是 200）——官方文档的原话是 *"Requesting an unset format will return a 403 Forbidden error."*。插件会把这一点写进错误消息，而不是静默返回空结果。`format=csv` / `format=rss` 也会一起 403，可以拿它们对照确认。

### 2.2 放行 DSH 主机的请求

SearXNG 默认开启限速/机器人检测，程序化请求容易被 429/403：

```yaml
server:
  limiter: false          # 自用最省事
# 或保留 limiter，把 DSH 主机的 IP（或网段）加入 botdetection 的 pass_ip / 白名单
```

### 2.3 确认 DSH 所在机器能直接访问该实例

把地址换成你自己的实例（下面的 `searxng.example:8888` 是占位符）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://searxng.example:8888/search?q=test&format=json'
```

返回 `200` 就说明服务端就绪（返回 `403` 就回到 2.1）。

> 建议用 `curl` 而不是 PowerShell 的 `Invoke-RestMethod`：后者在报错时可能不显示
> 响应体，排查时容易被误导。想看完整响应头用 `curl -s -i`。

---

## 3. 安装

安装前**先改好 `cordis.patch.yml` 里的 `baseURL`**（见 [4. 配置项](#4-配置项)）——
仓库里的值是占位符，不改的话插件的 `available()` 会返回 false，`web_search` 报
`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。

DSH 插件管理器的输入框接受：包名、Git 地址、压缩包、本地绝对路径。

### 方式 A：插件管理器 + 本地路径

1. 打开 DSH Web 界面 → 侧栏 **插件**（Plugins）→ **添加插件**。
2. 粘贴本仓库所在目录的**绝对路径**，例如 `D:\path\to\dsh-searxng-search`。
3. 点 **安装**，等 pnpm 跑完。
4. **完全重启 DSH**（见下面的「装完必做」）。

### 方式 B：插件管理器 + Git 地址

在同一个输入框里粘贴 Git 地址即可，不需要发布到 npm：

```
https://github.com/mimoxh/dsh-searxng-search
```

### 方式 C：npm（尚未发布）

本包目前**没有发布到 npm**。发布之后可以这样装：

```bash
dsh plugin --profile <profile> add dsh-searxng-search
```

### 方式 D：手工写入 profile（不推荐）

Plugin Manager 做的就是这几步，手工做需要自己承担风险。以 profile `desktop` 为例：

1. 编辑 `<DSH_HOME>/profiles/desktop/package.json`：

   ```json
   {
     "dependencies": {
       "dsh-searxng-search": "link:D:/path/to/dsh-searxng-search"
     },
     "dsh": {
       "profile": {
         "bundles": ["...", "dsh-searxng-search"]
       }
     }
   }
   ```

   `dsh.profile.bundles` 数组**末尾**追加包名（保证它的 patch 层最后应用）。

2. 在 profile 目录里用 DSH 捆绑的 pnpm 安装：

   ```bash
   node "<DSH 安装目录>/resources/runtime/pnpm/bin/pnpm.cjs" install
   ```

3. **完全重启 DSH**。

### 方式 E：命令行装到任意 profile（其他 surface 首选）

桌面端之外还有三个 surface，各自对应 `$DSH_HOME/profiles` 下的一个同名 profile：

| surface | profile | 备注 |
|---|---|---|
| 桌面 App | `desktop` | Electron 专用：`dsh --profile desktop ...` 会被直接拒绝（`error: profile "desktop" is managed exclusively by the Electron application`），只能按方式 A 在 App 里装 |
| `dsh web` / `dsh --profile web` | `web` | 浏览器 surface |
| `dsh tui` | `tui` | 终端界面 |
| `dsh headless "…"` | `headless` | 一次性任务，跑完退出 |

**profile 之间互不相干**：`dsh.profile.bundles` 各写各的，本包装进哪一个，就只有那个
surface 生效。DSH 自带的安装入口会跑 pnpm，并在包声明了 `dsh.bundle` 时把它追加进该
profile 的 `bundles`（参数直接透传给 pnpm）：

```bash
dsh plugin --profile web add "D:/path/to/dsh-searxng-search"     # 本地目录（link:）
dsh plugin --profile web add github:mimoxh/dsh-searxng-search    # Git（pnpm 的 github: 简写）
```

目标 profile 还不存在时，用 `--from-default-profile <shipped-template>` 从 shipped 模板
初始化（`dsh --help` 里的例子是 `dsh rescue --from-default-profile web`）。

装完仍是那一件事：让 `web` 行指向 searxng。组合包 patch 已经做了（只要包在 `bundles`
里就会应用），所以通常只差实例地址——用下面的 overlay，或按 [4. 配置项](#4-配置项) 写进
该 profile 自己的 `cordis.patch.yml`。

### 方式 F：用 `--patch` overlay 覆盖配置（不改 profile 文件）

`dsh` 支持在 profile 层之后再叠一层 patch，而且**可重复**：

```bash
export SEARXNG_BASE_URL=http://192.168.1.20:8086
dsh web      --patch ./examples/dsh-searxng.overlay.yml
dsh tui      --patch ./examples/dsh-searxng.overlay.yml
dsh headless --patch ./examples/dsh-searxng.overlay.yml "搜索今天的新闻"
```

[`examples/dsh-searxng.overlay.yml`](examples/dsh-searxng.overlay.yml) 只重述两行
**已经存在**的 row 的 `config`（`web` 与 `web-search-searxng`），不插入新 row——row 由
组合包 patch 插入，所以前提是该 profile 里已装本包（方式 E 的安装那一步）。

它的 `baseURL` 写成 `!!js process.env.SEARXNG_BASE_URL ?? '<占位>'`，在**组合期**取环境
变量，同一个文件就能在不同机器/不同实例间复用，不必改任何文件；变量没设时占位地址会让
provider 报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，而不是静默换一条搜索通道。

### 装到其他 surface 时的两个坑

1. **`web_search` 这个工具的归属，各 surface 不一样。** `dsh-base` 把 `tool-web` 放在
   host plane（`dsh tui` / `dsh headless` 走这条）；`dsh-web-app` 则把它
   `disabled: true` 掉，改由**每个 agent preset** 各自组合（桌面端与 `dsh web` 走这条）。
   所以在 Web 类 surface 上，除了 provider，还要确认该 session 用的 preset 挂了
   `tool-web`；否则 seam 里注册了提供方，也没有工具去调它。
2. **生效/重启语义不同。** 桌面端是常驻 host，装或改组合包必须**完全退出并重启**（见
   [7. 已知的 DSH 侧问题](#7-已知的-dsh-侧问题)）；`dsh tui` / `dsh web` /
   `dsh headless` 每次启动都重新组合 profile，所以下一次启动即生效。

### 装完必做

1. **改 `cordis.patch.yml` 的 `baseURL`**，指向你的实例。
2. **完全退出并重新启动 DSH**（关窗口不算，要确认进程退出）。

组合包的 patch 层是**在启动时**组合进 profile 的。新装/改动组合包后不重启，运行中的
DSH 仍然在用旧的组合——表现就是「插件卡片上显示组件已关闭，`web_search` 还在走
DeepSeek」。

---

## 4. 配置项

配置在 `cordis.patch.yml` 中 `web-search-searxng` 行的 `config` 里：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseURL` | 无（可用环境变量 `SEARXNG_BASE_URL` 兜底） | SearXNG 地址，含协议/端口/路径前缀，**不要**结尾斜杠 |
| `apiPath` | `/search` | JSON API 路径，仅当实例挂在别的路径下才改 |
| `language` | 不发送 | SearXNG `language`，如 `zh-CN`、`en-US`、`all` |
| `categories` | 不发送 | 如 `general`、`general,news` |
| `engines` | 不发送 | 限定引擎，如 `google,bing` |
| `timeRange` | 不发送 | `day` / `week` / `month` / `year` |
| `safeSearch` | 不发送 | `0` / `1` / `2` |
| `timeoutMs` | `15000` | 单次搜索超时（工具层还有 60s 预算） |
| `maxResults` | `10` | 本提供方自己的上限；seam 还会再按 `web_search` 请求的上限截断 |
| `userAgent` | `dsh-searxng-search/<包版本>` | 请求 UA（SearXNG 会拒绝空 UA）；默认值跟随 `package.json` 的 `version` |
| `headers` | `{}` | 额外请求头，例如反向代理前的 `Authorization: Bearer <token>` |

改动 `baseURL` 等配置后需要让组合包重新加载：桌面端**完全重启 DSH**，`dsh web` / `dsh tui` /
`dsh headless` 下次启动即生效。同样的字段也可以写在 `--patch` overlay 里（见
[3. 安装](#3-安装) 的方式 F），此时 `baseURL` 可用 `SEARXNG_BASE_URL` 兜底。

### 为什么没有配置 schema

本插件**故意不声明配置 schema**。声明 schema 能换来 DSH 在加载时校验配置、以及在设置
界面里渲染配置控件；但代价是必须 `import @deepseek-ai/schemastery`，而本项目刻意保持
**零 import**：

- 零依赖让自测可以离线跑、不需要 `npm install`，CI 里连安装步骤都不用；
- 它不依赖 DSH 内部如何解析随安装包一起分发的模块；
- DSH 升级 `schemastery` 时，schema 可能被判为
  `Config is not a native Schemastery schema`，从而**直接拒绝该行**——多一个失败面。

因此字段写错不会在加载时报错，而是在第一次搜索时报出带端点和处理建议的错误。如果你
更想要加载时校验，可以自行加 schema。

### 结果映射

SearXNG 的 `results[].url/title/content/publishedDate` → seam 的
`url/title/snippet/publishedAt`（按 URL 去重），`answers[]` → 给模型的直接答案
（`content`）。

---

## 5. 验证

### 5.1 离线自测（不依赖 DSH、不需要网络）

```bash
npm test        # 等价于 node test/smoke.mjs
```

17 项检查覆盖：注册 id、可用性判断、User-Agent 与版本一致、**`dsh.seams` 与 `inject`
一致**、**发布文件不带 UTF-8 BOM**、URL 构造、结果映射/去重/截断、真实 HTTP 往返
（内置 mock SearXNG）、HTML（未开 JSON）报错、403（未开 JSON 格式）报错、429 报错、
取消、不可达报错。

### 5.2 在 DSH 里验证

1. 让模型调用一次 `web_search`（例如「搜索 deepseek harness」）。
2. 看结果卡片的来源是否来自你的 SearXNG 引擎；若报错，错误消息里会带已解析的端点和
   处理建议。
3. 若来源看起来不对或报 `WEB_PROVIDER_CONFIGURED_MISSING`，检查 profile 里 `web` 行
   是否仍写着 `deepseek-official`，以及是否忘了重启 DSH。

### 5.3 安全自审（dsh-vet）

本包在每次 push / PR 上跑 [dsh-vet](https://github.com/rogerdigital/dsh-vet)：
[`.github/workflows/dsh-vet.yml`](.github/workflows/dsh-vet.yml) 审计的是 **`npm pack`
出来的产物**（也就是 `files` 列出来的东西），并用 `strict: true` 让 high 及以上、且置信度
≥ medium 的发现项直接让 CI 失败。

审计产物而不是整仓是刻意的：整仓扫描会把 `test/smoke.mjs` 也算进能力面（它读 JSON、开
mock HTTP 服务），多出三条与插件运行时无关的发现项——`fs` 读取计入
`perm.seam-mismatch`（medium/medium，会把整仓扫描的等级压到 C）、`node:http` 仅 import、
以及不可达文件。CI 因此只对产物定级。

本地复现同一份扫描：

```bash
npm pack --pack-destination .dsh-vet-pack
tar -xzf .dsh-vet-pack/*.tgz -C .dsh-vet-pack
npx --yes dsh-vet@0.4.0 --json .dsh-vet-pack/package
```

0.2.0 的实测结果是 **A 级**，报告里仍留着两条发现项——这是真实的剩余状态，不是清干净的
样板：

| 严重度 / 置信度 | 规则 | 说明 |
|---|---|---|
| high / **low** | `egress.secret-adjacent` | `index.js` 读 `process.env.SEARXNG_BASE_URL`，而同一文件里有出网调用。按 dsh-vet 的契约，**低置信度不参与定级** |
| info / high | `perm.network-client` | 声明 `dsh.seams: ["web"]` 后的正常清点项。未声明时它是 medium/high，等级会掉到 C |

想彻底消掉那条 `egress.secret-adjacent`，只能改成经 DSH 的
`@deepseek-ai/dsh-launch-environment` 读启动环境（对方 `dsh-searxng` 正是这么做的）——代价是
本项目"零 import"的底线，所以这里选择保留并写明。

等级徽章读 `dsh-vet/report` 分支上的报告（shields.io 直接读该分支的 `badge.json`，没有徽章
服务），因此它要等仓库推送、workflow 至少跑过一次之后才会显示。

---

## 6. 排错

| 现象 / 错误码 | 原因与处理 |
|---|---|
| `WEB_PROVIDER_AMBIGUOUS`（多个可用提供方） | `web` 行的 `searchProvider` 没被改成 `searxng`（patch 层顺序被更高层覆盖）。检查 profile 的 `cordis.patch.yml` 是否也写了 `web` 行；或在其中显式加 `searchProvider: searxng` |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | `searxng` 已注册但 `baseURL` 为空或不是合法 URL。填好 `baseURL`（或设 `SEARXNG_BASE_URL`）后重启 |
| `WEB_PROVIDER_CONFIGURED_MISSING` | 组合包没被启用/没装成功，提供方没注册；确认已重启 DSH |
| `SearXNG returned HTTP 403` + 提示 `search.formats` | **首查这个**：SearXNG 没开 `json` 输出格式（此时 HTML 搜索照常 200）。按 [2.1](#21-打开-json-api最常见的坑) 加上 `- json` 并重启 SearXNG |
| `SearXNG returned HTTP 403`（JSON 已开，仍被拒） | limiter / botdetection 拦截 —— 关掉 `server.limiter` 或把 DSH 主机 IP 加白 |
| `SearXNG returned HTTP 429` | limiter 限速 —— 同上 |
| `SearXNG returned HTTP 404` | `baseURL` / `apiPath` 不对 |
| 报错提到 `formats: [html, json]` | SearXNG 返回的是 HTML —— 按 [2.1](#21-打开-json-api最常见的坑) 打开 JSON API 并重启 |
| 请求超时 | 提高 `timeoutMs`；确认 DSH 主机到 SearXNG 的网络与 DNS |
| 搜索有结果但模型看不到 | 确认用的是 `web_search` 而不是某个 MCP 工具；结果里的来源来自 seam 的 `sources[]` |
| 结果为空 | SearXNG 的引擎本身没返回（可能是出网受限、`engines` 限制过窄、或 `categories` 不匹配）。先用 [2.3](#23-确认-dsh-所在机器能直接访问该实例) 的 `curl` 直接验证 SearXNG |
| 插件卡片显示组件「已关闭」 | 运行中的 DSH 是在装插件**之前**启动的。完全重启 DSH |
| `dsh tui` / `dsh headless` 上 `web_search` 仍走 DeepSeek | 该 profile 里没装本包——profile 之间互不相干，见 [3. 安装](#3-安装) 的方式 E |
| overlay 启动后报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | `SEARXNG_BASE_URL` 没设（占位地址不是真实例），或该 profile 里还没装本包（overlay 只覆盖**已有** row 的 `config`） |
| `dsh --profile desktop --dump-config` 报 profile 被独占 | 桌面端 profile 只能由 App 启动（`managed exclusively by the Electron application`）；换 `dsh web` / `dsh tui` 诊断，或用 App 里的插件管理器 |

---

## 7. 已知的 DSH 侧问题

在 Desktop 版的常驻 host 里，对**已安装**组合包的组件点「启用」开关，可能报：

```
dsh: profile reload requires the root Include entry
```

这是 DSH 侧的 profile 热重载失败（`@deepseek-ai/dsh-app-boot` 的
`reconcileProfilePatches()` 找不到根 Include 条目），**与本插件无关**。组合包的行本来
就会在启动时组合，所以**完全重启 DSH 即可**，不需要（也无法）用那个开关。

补充一条同源的差别：`desktop` profile 由 Electron **独占**——`dsh --profile desktop …`
（包括 `--dump-config`）会直接报 `error: profile "desktop" is managed exclusively by the
Electron application`。所以桌面端只能走 App 内的插件管理器，CLI 的那些诊断手段要用在
`dsh web` / `dsh tui` 上（见 [3. 安装](#3-安装) 的方式 E、F）。

---

## 8. 备选方案：MCP

如果不想写代码，也可以用配置型组合包把 SearXNG 的 MCP server 挂进来（需要能拿到该
server，比如 `mcp-searxng`）：

```yaml
- insert:
    - id: searxng-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: searxng
        transport: stdio
        command: node
        args: ['C:\\path\\to\\mcp-searxng\\dist\\index.js']
        env:
          SEARXNG_URL: http://searxng.example:8888
        failOnStartupError: true
```

区别：模型拿到的是 `mcp__searxng__searxng_web_search` 这样的独立工具，**不是**
`web_search`，也不会复用 DSH 的搜索结果卡片；而且要多跑一个 MCP 进程、多依赖一份第三方
代码。离线/内网场景下，本组合包（零依赖）更干净。

---

## 9. 开发与测试

| 文件 | 作用 |
|---|---|
| `index.js` | 提供方实现：`apply` / `inject`、配置规整、URL 构造、结果映射、错误码 |
| `cordis.patch.yml` | 组合包 patch：固定 `web.searchProvider = searxng` + 挂载提供方行 |
| `package.json` | 组合包清单（`dsh.bundle.patch`、`dsh.seams`、展示元信息） |
| `examples/dsh-searxng.overlay.yml` | `dsh --patch` 用的 overlay（见 [3. 安装](#3-安装) 的方式 F） |
| `locale/zh.json`、`locale/en.json` | 插件管理器卡片上的标题与描述 |
| `test/smoke.mjs` | 离线自测（内置 mock SearXNG） |
| `.github/workflows/ci.yml` | CI：Node 20.3/22/24 × Linux/Windows，另有 tarball 内容检查 |
| `.github/workflows/dsh-vet.yml` | 安全自审：扫 `npm pack` 产物并公示报告与等级（见 [5. 验证](#5-验证)） |

本地开发：

```bash
npm test
```

不需要 `npm install`：本项目没有任何依赖，测试只用 Node 内置模块。

修改 `index.js` 里的 `PACKAGE_VERSION` 时记得同步 `package.json` 的 `version`——
自测里有一项专门检查这两者是否一致。

> CI 与 dsh-vet 徽标都要等仓库推送、对应 workflow 至少跑过一次之后才会显示：CI 徽标来自
> `ci` workflow，dsh-vet 徽标来自 workflow 发布到 `dsh-vet/report` 分支的报告。

## License

[MIT](LICENSE)
