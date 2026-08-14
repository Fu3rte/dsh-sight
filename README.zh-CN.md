# dsh-sight

为纯文本 [DeepSeek Harness（dsh）](https://deepseek.com/harness) 模型提供插件式视觉能力——直接粘贴图片，通过内置 VLM 后端获得文字描述，无需切换模型。

[English → README.md](README.md)

## 特性

- **内置 VLM 预设** — OpenCode Zen（免费、免 key）和 Gemini Flash（免费额度）。在网页设置页选一个即可。
- **多图批量分析** — `vision` 工具一次调用最多接受 10 个路径/URL，单次请求完成全部描述，按图标注。

## 工作原理

1. **提示准入覆写** — dsh 会拒绝纯文本模型接收粘贴图片。dsh-sight 包装 `apiProxy.sessions.prompt`：接受粘贴，图片字节落地到 `/tmp/dsh-sight/image{N}/{hash}.png`，图片块在进入历史前变成路径提示。任何 provider 都可用——无需切换模型变体。
2. **`vision` 工具** — 模型拿着提示路径（或任意本地路径 / http(s) URL）调用它；插件读取字节并通过配置好的 OpenAI 兼容 VLM 后端作答。
3. **系统提示词分节** — 教会模型"提示 → `vision` 工具"的流程。
4. **网页设置页**（Settings → 视觉模型）— 预设下拉、API key 输入框、高级覆盖项。走标准 settings RPC 保存，即时生效、无需重启（通过 `$DSH_HOME/settings.yaml` 的 `dsh-sight:` 分节热加载）。

## 安装

```sh
dsh plugin --profile web add github:fu3rte/dsh-sight
```

（发布到 npm 后可用 `dsh plugin --profile web add dsh-sight`）

## 配置

打开 dsh 网页 → **Settings → 视觉模型**：

1. 选择一个预设（model / base URL 自动填充）。
2. 需要 key 时粘贴 API key，点保存——立即生效。

| 预设 | Provider | Key 环境变量 | 价格 |
|---|---|---|---|
| `opencode-zen` | OpenCode Zen | _（免 key）_ | 免费层 |
| `gemini-flash` | Google AI Studio（OpenAI 兼容） | `GEMINI_API_KEY` | 免费额度 |

免 key 预设点一下保存即可。任何其他 OpenAI 兼容端点也能用：在高级设置里填写 model / baseUrl。

### 无 GUI / Headless 兜底

配置分层（优先级从高到低）：

1. `settings.yaml` 的 `dsh-sight:` 分节（编辑即热加载）
2. `DSH_SIGHT_*` 环境变量（`DSH_SIGHT_PROVIDER`、`DSH_SIGHT_API_KEY`、`DSH_SIGHT_MODEL`、`DSH_SIGHT_BASE_URL`、`DSH_SIGHT_TIMEOUT_MS`、`DSH_SIGHT_MAX_TOKENS`、`DSH_SIGHT_MAX_IMAGES`、`DSH_SIGHT_CONFIG`）
3. `~/.config/dsh-sight/config.json`（mtime 变化时重读）
4. profile 的 `cordis.patch.yml` 中插件行配置
5. 预设默认值

API key 是 `role('secret')`：绝不随 settings 响应返回；UI 渲染为只写输入框，仅提示是否已保存。

## 多图批量

`vision` 工具的 `paths` 数组每次最多 10 张（本地路径或 URL，单张上限 25 MiB）。一次请求，逐图标注：

```
--- Image 1 ---
<描述>
--- Image 2 ---
<描述>
```

## 开发

```sh
pnpm install                 # 插件本地依赖（schemastery、dsh-settings）
node test/engine-smoke.mjs   # 引擎：批量、免 key、扩展名守卫
node test/plugin-apply.mjs   # 注册：工具、准入覆写、settings 接线
dsh plugin --profile test add ./   # 本地安装
dsh --profile test --dump-config   # 验证配置层
```

## 致谢

设计借鉴自 [opencode](https://github.com/anomalyco/opencode) 的 vision-helper 模式、[modlens](https://github.com/liustack/modlens) 和 [dsh-eyes](https://github.com/JY626/dsh-eyes)。

DeepSeek Harness：[官方网站](https://deepseek.com/harness) · [GitHub](https://github.com/deepseek-ai/deepseek-harness)

License: MIT
