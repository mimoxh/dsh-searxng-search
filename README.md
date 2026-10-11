# dsh-searxng-search

[![test](https://github.com/mimoxh/dsh-searxng-search/actions/workflows/ci.yml/badge.svg)](https://github.com/mimoxh/dsh-searxng-search/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node >= 20.3.0](https://img.shields.io/badge/node-%3E%3D20.3.0-brightgreen.svg)

让 DSH 内置的 `web_search` 工具改走 [SearXNG](https://docs.searxng.org/)，替代随 DSH 一起提供的 DeepSeek 搜索通道。适合自建/内网 SearXNG 的场景。

- **零依赖**：只用 Node 全局 `fetch` / `URL` / `AbortSignal`，不 import 任何包，无构建步骤。
- **不改工具契约**：复用 DSH 的 web 能力 seam（`ctx.web`），模型侧仍然是原来的 `web_search` 工具，参数、结果卡片、引用格式全部不变。
- **不影响 `web_fetch`**：抓取 URL 仍由随附的 `dsh-web-fetch-http` 提供。
- **离线自测**：15 项检查（`npm test`），不需要网络、不需要安装依赖。

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
| `userAgent` | `dsh-searxng-search/0.1.0` | 请求 UA（SearXNG 会拒绝空 UA） |
| `headers` | `{}` | 额外请求头，例如反向代理前的 `Authorization: Bearer <token>` |

改动 `baseURL` 等配置后需要让组合包重新加载：**重启 DSH**。

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

15 项检查覆盖：注册 id、可用性判断、User-Agent 版本、URL 构造、结果映射/去重/截断、
真实 HTTP 往返（内置 mock SearXNG）、HTML（未开 JSON）报错、403（未开 JSON 格式）
报错、429 报错、取消、不可达报错。

### 5.2 在 DSH 里验证

1. 让模型调用一次 `web_search`（例如「搜索 deepseek harness」）。
2. 看结果卡片的来源是否来自你的 SearXNG 引擎；若报错，错误消息里会带已解析的端点和
   处理建议。
3. 若来源看起来不对或报 `WEB_PROVIDER_CONFIGURED_MISSING`，检查 profile 里 `web` 行
   是否仍写着 `deepseek-official`，以及是否忘了重启 DSH。

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

---

## 7. 已知的 DSH 侧问题

在 Desktop 版的常驻 host 里，对**已安装**组合包的组件点「启用」开关，可能报：

```
dsh: profile reload requires the root Include entry
```

这是 DSH 侧的 profile 热重载失败（`@deepseek-ai/dsh-app-boot` 的
`reconcileProfilePatches()` 找不到根 Include 条目），**与本插件无关**。组合包的行本来
就会在启动时组合，所以**完全重启 DSH 即可**，不需要（也无法）用那个开关。

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
| `package.json` | 组合包清单（`dsh.bundle.patch`、展示元信息） |
| `locale/zh.json`、`locale/en.json` | 插件管理器卡片上的标题与描述 |
| `test/smoke.mjs` | 离线自测（内置 mock SearXNG） |
| `.github/workflows/ci.yml` | CI：Node 20.3/22/24 × Linux/Windows，另有 tarball 内容检查 |

本地开发：

```bash
npm test
```

不需要 `npm install`：本项目没有任何依赖，测试只用 Node 内置模块。

修改 `index.js` 里的 `PACKAGE_VERSION` 时记得同步 `package.json` 的 `version`——
自测里有一项专门检查这两者是否一致。

> CI 徽标要等仓库推送、workflow 至少跑过一次之后才会显示。

## License

[MIT](LICENSE)
