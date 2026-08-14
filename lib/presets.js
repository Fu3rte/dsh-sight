// Built-in VLM presets: pick one in the web settings page (or config), fill
// the matching API key, done. Every field is overridable per preset via the
// settings.yaml `dsh-sight:` section (hot-reload), DSH_SIGHT_* env vars, or
// ~/.config/dsh-sight/config.json.
//
// type: 'openai'   → OpenAI-compatible POST {baseUrl}/chat/completions
// type: 'minimax'  → MiniMax native POST {baseUrl}/v1/coding_plan/vlm (single image per call)
// keyless: true    → the endpoint needs no API key (no Authorization header).

export const PRESETS = {
  'opencode-zen': {
    label: 'OpenCode Zen (free tier, keyless)',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'mimo-v2.5-free',
    keyEnv: null,
    keyless: true,
  },
  ollama: {
    label: 'Ollama (local, keyless)',
    type: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl:7b',
    keyEnv: null,
    keyless: true,
  },
  'glm-4v-flash': {
    label: 'GLM-4V-Flash — Zhipu BigModel (free tier)',
    type: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    keyEnv: 'ZHIPU_API_KEY',
    keyless: false,
  },
  'mimo-v2.5': {
    label: 'MiMo-V2.5 — MiniMax (¥1 / ¥2 per M tokens)',
    type: 'minimax',
    baseUrl: 'https://api.minimax.io',
    model: 'MiMo-V2.5',
    keyEnv: 'MINIMAX_API_KEY',
    keyless: false,
  },
  'gpt-4o-mini': {
    label: 'GPT-4o-mini — OpenAI ($0.15 / $0.60)',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
    keyless: false,
  },
  'gemini-flash': {
    label: 'Gemini Flash — Google AI Studio (free tier, OpenAI-compatible)',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    keyEnv: 'GEMINI_API_KEY',
    keyless: false,
  },
  'opencode-zen-go': {
    label: 'OpenCode Zen Go ($10/mo: mimo-v2.5, minimax-m3, gpt-5.6-luna, …)',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'mimo-v2.5',
    keyEnv: 'ZEN_API_KEY',
    keyless: false,
  },
}

export const PRESET_IDS = Object.keys(PRESETS)
