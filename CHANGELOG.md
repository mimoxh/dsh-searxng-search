# Changelog

## 0.2.0 — 2026-10-12

可审计性与跨 surface 版本。插件运行时行为不变。

- **声明 `dsh.seams: ["web"]`**：dsh-vet 的 `perm.network-client` 由 medium/high 降为
  info/high（规则原话：声明了 web seam 即"预期能力，只作清点"），**产物扫描等级由 C 升到
  A**（本地实测）。自测新增一项，锁定 `dsh.seams` 与 `inject` 一致，防止声明漂移。
- **接入 dsh-vet 自审**：`.github/workflows/dsh-vet.yml` 在 push / PR 上审计 `npm pack`
  产物（而非整仓——整仓扫描会把测试代码算进能力面），`strict: true` 作为 high 及以上的
  门禁；main 上把报告与等级徽章发布到 `dsh-vet/report` 分支。
- **新增 `examples/dsh-searxng.overlay.yml`**：用 `dsh --patch` 给任意 profile 叠加配置，
  不改 profile 文件；`baseURL` 经 `!!js process.env.SEARXNG_BASE_URL ?? '<占位>'` 在组合期
  求值，同一个文件可跨机器、跨实例复用。
- **README 补「方式 E / F」与「装到其他 surface 时的两个坑」**：`dsh plugin --profile
  <name> add` 的安装路径；`web_search`（`tool-web`）在 base（host plane）与 dsh-web-app
  （agent preset）两层归属不同；桌面端常驻 host 必须完全重启而 CLI surface 下次启动即
  生效。另记录：`desktop` profile 由 Electron 独占，`dsh --profile desktop …` 会被拒绝。
- **新增 §5.3 安全自审**：写明实测等级与残留发现项（`egress.secret-adjacent` high/low、
  `perm.network-client` info/high），以及为什么保留 `process.env` 读取而不引入 import。
- 自测 16 → 17 项；User-Agent 断言改为从 `package.json` 派生版本，不再硬编码。
- 版本号 0.1.0 → 0.2.0（`index.js` 的 `PACKAGE_VERSION` 已同步）。

## 0.1.0 — 2026-10-12

首个公开版本。

- 提供方 `searxng`：通过 `ctx.web`（`@deepseek-ai/dsh-web`）注册，模型侧的
  `web_search` 工具与其结果卡片保持不变。
- 组合包 patch 固定 `web.searchProvider = searxng`，避免与随附的
  `deepseek-official` 提供方同时可用而报 `WEB_PROVIDER_AMBIGUOUS`。
- 零依赖、无构建步骤，只用 Node 全局（`fetch` / `URL` / `AbortSignal`）。
- 离线自测 16 项（`npm test`），不需要网络、不需要安装依赖。
- 自测新增「发布文件不得带 UTF-8 BOM」检查：DSH 对插件清单与 locale JSON 使用裸
  `JSON.parse`，带 BOM 的清单会让 DSH 启动失败（profile 清单尤其致命）。
- HTTP 403 的错误消息区分两种成因：SearXNG 未在 `search.formats` 打开
  `json`（HTML 搜索仍为 200），以及 limiter / botdetection 拦截。
- 由内部包名 `@local/dsh-searxng-search@1.0.0` 改名并整理为公开发布。
