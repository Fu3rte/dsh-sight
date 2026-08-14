# dsh-vision-helper

Plug-in vision for text-only [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) models. A dsh port of the opencode `vision-helper` pattern, with two upgrades:

- **Built-in VLM presets** — GLM-4V-Flash (free), Gemini Flash (free tier), OpenCode Zen (free tier), MiMo-V2.5, GPT-4o-mini, and more. Fill one API key, pick a preset id; no baseUrl/model assembly.
- **Multi-image batch** — the `vision` tool takes N paths/URLs and describes all of them in a single request, labeled per image.

## How it works

1. **`vision` tool** — the model calls it with local file paths or http(s) URLs; the plugin reads the bytes and answers through the configured VLM backend (OpenAI-compatible or MiniMax native).
2. **Vision provider wrapper** (`deepseek-vision`) — dsh's DeepSeek adapter refuses image pastes at intake (text-only). This plugin registers a wrapped model variant that admits images, saves each paste to `/tmp/dsh-vision/image{N}/{hash}.png`, and replaces the image block with a path hint before delegating back upstream. The durable log keeps the real image; only the wire message changes.
3. **System-prompt section** — teaches the model the hint → `vision` tool flow.

No build step, no runtime dependencies (plain ESM + Node builtins), so `dsh plugin add github:…` works without pnpm build permissions.

## Install

```sh
dsh plugin --profile web add github:fu3rte/dsh-vision-helper
```

(or publish to npm and `dsh plugin --profile web add dsh-vision-helper`)

## Configure a preset

Minimal setup: pick a preset id and export its key.

| Preset id | Provider | API key env | Price |
|---|---|---|---|
| `glm-4v-flash` | Zhipu BigModel | `ZHIPU_API_KEY` | free |
| `gemini-flash` | Google AI Studio (OpenAI-compat) | `GEMINI_API_KEY` | free tier |
| `opencode-zen` | OpenCode Zen | `ZEN_API_KEY` | free tier |
| `mimo-v2.5` | MiniMax (native VLM endpoint) | `MINIMAX_API_KEY` | ¥1/¥2 per M tokens |
| `gpt-4o-mini` | OpenAI | `OPENAI_API_KEY` | $0.15/$0.60 |
| `opencode-zen-go` | OpenCode Zen Go ($10/mo) | `ZEN_API_KEY` | mimo-v2.5, minimax-m3, gpt-5.6-luna… |
| `custom` | any OpenAI-compatible endpoint | `DSH_VISION_API_KEY` | — |

```sh
export ZHIPU_API_KEY=sk-xxxx   # example: GLM-4V-Flash
```

Then use dsh normally. Pasting an image, or pointing the model at a file, routes through the vision bridge.

### Config file

`~/.config/dsh-vision-helper/config.json` (keep it `chmod 600`):

```json
{
  "provider": "opencode-zen-go",
  "apiKey": "sk-…",
  "model": "minimax-m3",
  "baseUrl": "https://opencode.ai/zen/go/v1",
  "apiType": "openai",
  "timeoutMs": 120000,
  "maxTokens": 4096,
  "toolName": "vision",
  "visionProvider": true,
  "systemPrompt": true
}
```

Priority: **env > config file > plugin row config > preset defaults**. The file is re-read on mtime change — edits apply on the next tool call, no restart.

### Environment variables

| Var | Meaning |
|---|---|
| `DSH_VISION_PROVIDER` | preset id or `custom` |
| `DSH_VISION_API_KEY` | explicit key (beats the preset's own env) |
| `DSH_VISION_MODEL` / `DSH_VISION_BASE_URL` / `DSH_VISION_API_TYPE` | overrides (`openai` \| `minimax`) |
| `DSH_VISION_TIMEOUT_MS` / `DSH_VISION_MAX_TOKENS` | engine tuning |
| `DSH_VISION_MAX_IMAGES` | LRU cap of stored pastes (default 200) |
| `DSH_VISION_CONFIG` | config file path override |

### Plugin row config

In your profile's `cordis.patch.yml` you can also set defaults:

```yaml
- id: dsh-vision-helper
  name: dsh-vision-helper
  config:
    provider: glm-4v-flash
    toolName: vision
    visionProvider: true
```

## Multi-image batch

The `vision` tool's `paths` array takes up to 10 images per call (local paths or URLs, 25 MiB each). One request, per-image labels:

```
--- Image 1 ---
<description>
--- Image 2 ---
<description>
```

(MiniMax's native VLM endpoint is single-image; the plugin loops and joins with the same labels.)

## Comparison with modlens

[dsh-vision-helper](https://github.com/fu3rte/dsh-vision-helper) is the modlens-for-dsh alternative with a smaller footprint (no CLI, no electron spawn, no separate engine install):

| | modlens | dsh-vision-helper |
|---|---|---|
| Engine | bundled CLI (own release cadence) | inline in the plugin |
| Output | structured 5-part evidence schema | plain descriptions (+ batch labels) |
| Models | antigravity-cli / gemini / openai / anthropic / claude-cli | presets incl. GLM-4V-Flash, Zen free tier, MiMo-V2.5 |
| Multi-image | one per call | batch up to 10 in one request |
| Paste intake | client.js paste-to-path + provider wrapper | provider wrapper (no browser half) |

## Development

```sh
dsh plugin --profile test add ./            # local install
dsh --profile test --dump-config            # verify the layer
```

License: MIT
