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
5. **缓存清理** — 粘贴图片存放于 `/tmp/dsh-sight/image{N}/`，MD5 去重，LRU 上限（`maxImages`，默认 200）。启动时清扫超过 7 天的 `image*` 目录（`DSH_SIGHT_MAX_AGE_DAYS`），只动插件自己的目录；系统重启也会清空 `/tmp`。
6. **安全设置** — API key 是 `role('secret')`，绝不随 settings 响应返回。本地读取上限 25 MiB；URL 抓取限 30s 超时、25 MiB 上限、且必须声明 `image/*` 类型。远程内容先下载再内联——vision API 永远收不到你的 URL（无 SSRF 面）。只接受 png/jpeg/webp/gif/bmp。

## 效果演示

<p align="center">
  <img src="assets/demo/demo1.png" width="300" alt="粘贴截图 1" />
  <img src="assets/demo/demo2.png" width="300" alt="粘贴截图 2" />
</p>

<p align="center">
  <img src="assets/demo/demo.png" width="640" alt="dsh-sight 工作流" />
</p>

<p align="center">
  <img src="assets/demo/result.png" width="640" alt="模型描述输出" />
</p>

`vision` 工具的 `paths` 数组每次最多 10 张（本地路径或 URL，单张上限 25 MiB）。一次请求，逐图标注：

```
--- Image 1 ---
<描述>
--- Image 2 ---
<描述>
```

## 安装

**交给你的 AI Agent**（推荐）——把这句话复制给你的 Agent：

```
帮我安装 dsh-sight：https://raw.githubusercontent.com/Fu3rte/dsh-sight/master/install.md
```

或者手动安装：

```sh
dsh plugin --profile web add github:Fu3rte/dsh-sight
```

也可以直接 clone 下来：

```sh
git clone https://github.com/Fu3rte/dsh-sight.git
cd dsh-sight && pnpm install
dsh plugin --profile web add ./
```

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

## 致谢

设计借鉴自 [modlens](https://github.com/liustack/modlens) 和 [dsh-eyes](https://github.com/JY626/dsh-eyes)。

DeepSeek Harness：[官方网站](https://deepseek.com/harness) · [GitHub](https://github.com/deepseek-ai/deepseek-harness)

License: MIT
