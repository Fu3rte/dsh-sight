// Built-in VLM presets: fill the matching API key and go. Every preset is
// overridable via the config file (~/.config/dsh-sight/config.json),
// environment variables (DSH_SIGHT_*), or the plugin row config.
//
// type: 'openai'   → OpenAI-compatible POST {baseUrl}/chat/completions
// type: 'minimax'  → MiniMax native POST {baseUrl}/v1/coding_plan/vlm (single image per call)

export const PRESETS = {
  'glm-4v-flash': {
    label: 'GLM-4V-Flash — Zhipu BigModel (free tier)',
    type: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    keyEnv: 'ZHIPU_API_KEY',
  },
  'mimo-v2.5': {
    label: 'MiMo-V2.5 — MiniMax (¥1 / ¥2 per M tokens)',
    type: 'minimax',
    baseUrl: 'https://api.minimax.io',
    model: 'MiMo-V2.5',
    keyEnv: 'MINIMAX_API_KEY',
  },
  'gpt-4o-mini': {
    label: 'GPT-4o-mini — OpenAI ($0.15 / $0.60)',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
  },
  'gemini-flash': {
    label: 'Gemini Flash — Google AI Studio (free tier, OpenAI-compatible)',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    keyEnv: 'GEMINI_API_KEY',
  },
  'opencode-zen': {
    label: 'OpenCode Zen (free tier, e.g. mimo-v2.5-free)',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'mimo-v2.5-free',
    keyEnv: 'ZEN_API_KEY',
  },
  'opencode-zen-go': {
    label: 'OpenCode Zen Go ($10/mo: mimo-v2.5, minimax-m3, gpt-5.6-luna, …)',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'mimo-v2.5',
    keyEnv: 'ZEN_API_KEY',
  },
}

export function listPresetIds() {
  return Object.keys(PRESETS)
}
