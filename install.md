# Install dsh-sight (for agents)

Add plug-in vision to a text-only DeepSeek Harness (dsh) model. One command, no restart.

## Install

```sh
dsh plugin --profile web add github:fu3rte/dsh-sight
```

## Configure

Ask the user to open the dsh web UI → **Settings → Vision (视觉模型)**:

1. Pick a preset: `opencode-zen` (free, keyless) or `gemini-flash` (needs `GEMINI_API_KEY`).
2. Paste the API key if required, hit **Save**. Applies live — no restart.

Headless alternative: set `DSH_SIGHT_PROVIDER` / `DSH_SIGHT_API_KEY` etc. in `settings.yaml` under the `dsh-sight:` section.

## How the user uses it

- The user pastes an image; the plugin stores it and replaces it with a hint such as `[Image #1 auto-saved to /tmp/dsh-sight/image1/xxxx.png]`.
- Call the `vision` tool with that path (or any local path / http(s) URL), optionally with a `question`:

```json
{ "paths": ["/tmp/dsh-sight/image1/xxxx.png"], "question": "What does this chart show?" }
```

- Multi-image batch: pass up to 10 paths in one call (25 MiB each).

## Verify

Have the user paste an image and confirm a text description comes back. If the tool errors with "No vision backend configured", the preset / model / baseUrl / API key is missing — check Settings → Vision.

Docs: [README.md](README.md) · dsh: https://deepseek.com/harness
