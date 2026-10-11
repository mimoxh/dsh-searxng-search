# Changelog

## 0.1.0 — 2026-10-12

首个公开版本。

- 提供方 `searxng`：通过 `ctx.web`（`@deepseek-ai/dsh-web`）注册，模型侧的
  `web_search` 工具与其结果卡片保持不变。
- 组合包 patch 固定 `web.searchProvider = searxng`，避免与随附的
  `deepseek-official` 提供方同时可用而报 `WEB_PROVIDER_AMBIGUOUS`。
- 零依赖、无构建步骤，只用 Node 全局（`fetch` / `URL` / `AbortSignal`）。
- 离线自测 15 项（`npm test`），不需要网络、不需要安装依赖。
- HTTP 403 的错误消息区分两种成因：SearXNG 未在 `search.formats` 打开
  `json`（HTML 搜索仍为 200），以及 limiter / botdetection 拦截。
- 由内部包名 `@local/dsh-searxng-search@1.0.0` 改名并整理为公开发布。
