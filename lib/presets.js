// Built-in VLM presets. type: 'openai' = OpenAI-compatible chat/completions
// endpoint; keyless: true = no API key / Authorization header needed.
// `custom` is the settings page's explicit bring-your-own-endpoint mode: no
// defaults, so deriveConfig resolves model/baseUrl/apiKey from the user's
// fields (see lib/config.js).

export const PRESETS = {
  'opencode-zen': {
    label: 'OpenCode Zen',
    type: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'mimo-v2.5-free',
    keyEnv: null,
    keyless: true,
  },
  'gemini-flash': {
    label: 'Gemini Flash — Google AI Studio',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    keyEnv: 'GEMINI_API_KEY',
    keyless: false,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    type: 'openai',
    baseUrl: '',
    model: '',
    keyEnv: null,
    keyless: false,
  },
}
