# dsh-sight — Agent Installation Guide

This file is an instruction set for AI agents. A user triggers it with a prompt like: "帮我安装 dsh-sight：https://raw.githubusercontent.com/Fu3rte/dsh-sight/master/install.md" — read this file, follow the steps, and report back when done.

## Goal

Install the dsh-sight plugin so a text-only DeepSeek Harness (dsh) model can see pasted images via a VLM backend. After installation, images pasted into the chat are auto-saved and replaced with path hints, and the model describes them through the `vision` tool.

## Boundaries

- DO NOT run commands with `sudo` unless the user explicitly approves.
- DO NOT edit the user's `settings.yaml` or any file outside the dsh profile without asking.
- DO NOT invent API keys or sign the user up for services; if a key is missing, ask the user.
- If anything needs user input (keys, credentials), ask and let them decide.

## Step 1: Install

Preferred (npm registry — fast, works behind China mirrors):

```bash
dsh plugin --profile web add dsh-sight
```

Alternative (from GitHub — may be slow on unstable networks):

```bash
dsh plugin --profile web add github:Fu3rte/dsh-sight
```

Alternative (from a clone):

```bash
git clone https://github.com/Fu3rte/dsh-sight.git
cd dsh-sight && pnpm install
dsh plugin --profile web add ./
```

If the npm install is still slow, point pnpm at a China mirror first:

```bash
pnpm config set registry https://registry.npmmirror.com
```

Verify the plugin is registered:

```bash
dsh --profile web --dump-config | grep -i dsh-sight
```

## Step 2: Configure

Ask the user to open the dsh web UI (Settings → Vision / 视觉模型):

1. Pick a preset: `opencode-zen` (free, keyless) or `gemini-flash` (needs `GEMINI_API_KEY`).
2. Paste the API key if required, hit **Save**. Applies live — no restart.

Headless (no GUI): add to `$DSH_HOME/settings.yaml`:

```yaml
dsh-sight:
  provider: opencode-zen   # or gemini-flash + apiKey
```

Config layers (highest wins): settings.yaml `dsh-sight:` > `DSH_SIGHT_*` env > `~/.config/dsh-sight/config.json` > plugin row config > preset defaults.

## Step 3: How the user uses it

- The user pastes an image; the plugin stores it and replaces it with a hint such as `[Image #1 auto-saved to /tmp/dsh-sight/image1/xxxx.png]`.
- Call the `vision` tool with that path (or any local path / http(s) URL), optionally with a `question`:

```json
{ "paths": ["/tmp/dsh-sight/image1/xxxx.png"], "question": "What does this chart show?" }
```

- Multi-image batch: up to 10 paths per call, 25 MiB each.

## Step 4: Verify

Have the user paste an image and confirm a text description comes back. If the tool errors with "No vision backend configured", the preset / model / baseUrl / API key is missing — check Settings → Vision.

## Quick Reference

| Item | Value |
|---|---|
| Plugin | `dsh-sight` (npm) · `github:Fu3rte/dsh-sight` |
| Tool name | `vision` |
| Image store | `/tmp/dsh-sight/image{N}/{hash}.{ext}` |
| Settings section | `dsh-sight:` in `settings.yaml` |
| Env prefix | `DSH_SIGHT_*` |
| Docs | [README.md](README.md) · dsh: https://deepseek.com/harness |
