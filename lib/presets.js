// Built-in VLM presets: pick one in the web settings page (or config), fill
// the matching API key when one is needed, done. Every field is overridable
// per preset via the settings.yaml `dsh-sight:` section (hot-reload),
// DSH_SIGHT_* env vars, or ~/.config/dsh-sight/config.json.
//
// type: 'openai'   → OpenAI-compatible POST {baseUrl}/chat/completions
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
  'gemini-flash': {
    label: 'Gemini Flash — Google AI Studio (free tier, OpenAI-compatible)',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    keyEnv: 'GEMINI_API_KEY',
    keyless: false,
  },
}
