// dsh-sight web settings page: pick a VLM preset, fill the API key, save —
// applied live via the settings RPC (no restart). Registered into the dsh
// settings panel through the `settings.section` slot.
//
// The API key is `role('secret')` server-side: settings.describe never returns
// it; the `secrets` sidecar only reports whether a value is stored. The input
// is therefore write-only — typing a key and saving persists it, leaving the
// field empty while it is set.
//
// Mirrors the preset table in lib/presets.js (client bundles cannot import
// the server module); keep in sync when presets change.

window.__ModuleLoader__.load({
  id: 'dsh-sight',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const { useEffect, useState } = react

    const NS = 'dsh-sight'

    const CLIENT_PRESETS = {
      'opencode-zen': { label: 'OpenCode Zen（免费层，免 key）', model: 'mimo-v2.5-free', baseUrl: 'https://opencode.ai/zen/v1', apiType: 'openai', keyless: true, keyEnv: null },
      ollama: { label: 'Ollama 本地模型（免 key）', model: 'qwen2.5vl:7b', baseUrl: 'http://127.0.0.1:11434/v1', apiType: 'openai', keyless: true, keyEnv: null },
      'glm-4v-flash': { label: 'GLM-4V-Flash — 智谱 BigModel（免费额度，需注册 key）', model: 'glm-4v-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiType: 'openai', keyless: false, keyEnv: 'ZHIPU_API_KEY' },
      'mimo-v2.5': { label: 'MiMo-V2.5 — MiniMax（¥1 / ¥2 每百万 token）', model: 'MiMo-V2.5', baseUrl: 'https://api.minimax.io', apiType: 'minimax', keyless: false, keyEnv: 'MINIMAX_API_KEY' },
      'gpt-4o-mini': { label: 'GPT-4o-mini — OpenAI（$0.15 / $0.60）', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiType: 'openai', keyless: false, keyEnv: 'OPENAI_API_KEY' },
      'gemini-flash': { label: 'Gemini Flash — Google AI Studio（免费额度，需注册 key）', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiType: 'openai', keyless: false, keyEnv: 'GEMINI_API_KEY' },
      'opencode-zen-go': { label: 'OpenCode Zen Go（$10/月：mimo-v2.5, minimax-m3, …）', model: 'mimo-v2.5', baseUrl: 'https://opencode.ai/zen/go/v1', apiType: 'openai', keyless: false, keyEnv: 'ZEN_API_KEY' },
      custom: { label: 'Custom (OpenAI-compatible)', model: '', baseUrl: '', apiType: 'openai', keyless: false, keyEnv: null },
    }

    const PRESET_OPTIONS = Object.keys(CLIENT_PRESETS).map((id) => ({
      id,
      label: id === 'custom' ? '自定义（OpenAI 兼容）' : CLIENT_PRESETS[id].label,
      keyless: id !== 'custom' && CLIENT_PRESETS[id].keyless === true,
    }))

    const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' }
    const inputStyle = {
      width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '14px', color: 'inherit',
      background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
      border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(128,128,128,0.4))', borderRadius: '8px', outline: 'none',
    }
    const buttonStyle = { cursor: 'pointer', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '14px', background: 'var(--dsw-alias-interactive-bg-primary, #2563eb)', color: '#fff' }
    const buttonDisabled = { ...buttonStyle, opacity: 0.5, cursor: 'default' }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '20px', margin: 0 }

    function Field(props) {
      return react.createElement('div', { style: { marginBottom: '12px' } }, [
        react.createElement('label', { key: 'l', style: labelStyle }, props.label),
        react.createElement(props.tag || 'input', {
          key: 'i',
          style: inputStyle,
          type: props.type || 'text',
          value: props.value ?? '',
          placeholder: props.placeholder,
          ...(props.tag === 'select'
            ? { onChange: (event) => props.onChange(event.target.value) }
            : { onChange: (event) => props.onChange(event.target.value) }),
        }, props.tag === 'select'
          ? props.options.map((option) => react.createElement('option', {
            key: option.id, value: option.id,
          }, (option.keyless ? '免 key · ' : '') + option.label))
          : undefined),
      ])
    }

    function DshSightSection(props) {
      const api = props.api
      const [form, setForm] = useState({ provider: 'glm-4v-flash', model: '', baseUrl: '', apiType: 'openai', timeoutMs: '120000', maxTokens: '4096' })
      const [apiKeyInput, setApiKeyInput] = useState('')
      const [keySet, setKeySet] = useState(false)
      const [revision, setRevision] = useState(undefined)
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(null)
      const [error, setError] = useState(null)

      const refresh = async () => {
        setLoading(true)
        setError(null)
        try {
          const describe = await api.settings.describe({})
          if (describe?.result?.ok !== true) throw new Error(describe?.result?.error?.message ?? 'settings.describe failed')
          const ns = (describe.result.value.namespaces ?? []).find((entry) => entry.ns === NS)
          const value = (ns && typeof ns === 'object' && ns.value && typeof ns.value === 'object') ? ns.value : {}
          const secrets = Array.isArray(ns?.secrets) ? ns.secrets : []
          const apiKeySecret = secrets.find((s) => Array.isArray(s.path) && s.path[0] === 'apiKey')
          setRevision(ns?.revision)
          setKeySet(apiKeySecret?.set === true)
          setForm({
            provider: typeof value.provider === 'string' && value.provider !== '' ? value.provider : 'glm-4v-flash',
            model: typeof value.model === 'string' ? value.model : '',
            baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
            apiType: value.apiType === 'minimax' ? 'minimax' : 'openai',
            timeoutMs: String(value.timeoutMs ?? 120000),
            maxTokens: String(value.maxTokens ?? 4096),
          })
          setSaved(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => { refresh() }, [])

      const onProvider = (provider) => {
        const preset = CLIENT_PRESETS[provider]
        setForm((prev) => ({
          ...prev,
          provider,
          ...(preset ? { model: preset.model, baseUrl: preset.baseUrl, apiType: preset.apiType } : {}),
        }))
        setSaved(null)
      }

      const save = async () => {
        setSaving(true)
        setError(null)
        setSaved(null)
        try {
          const timeoutMs = Number(form.timeoutMs)
          const maxTokens = Number(form.maxTokens)
          if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs 必须是正整数')
          if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error('maxTokens 必须是正整数')
          const patch = {
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
            apiType: form.apiType,
            timeoutMs,
            maxTokens,
          }
          if (apiKeyInput !== '') patch.apiKey = apiKeyInput
          const res = await api.settings.update({
            ns: NS,
            patch,
            ...(revision === undefined ? {} : { expectedRevision: revision }),
          })
          if (res?.result?.ok !== true) {
            const failure = res?.result?.error
            throw new Error(failure?.message ?? 'settings.update failed' + (failure?.code !== undefined ? ` (${failure.code})` : ''))
          }
          setApiKeyInput('')
          setSaved('已保存，立即生效（无需重启）')
          await refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setSaving(false)
        }
      }

      const preset = CLIENT_PRESETS[form.provider] ?? CLIENT_PRESETS.custom
      const keyEnvHint = preset.keyless
        ? '此预设无需 API key'
        : `key 环境变量：${preset.keyEnv}（或 DSH_SIGHT_API_KEY）；此处留空则不覆盖已有配置`
      const backendReady = form.baseUrl !== '' && form.model !== '' && (preset.keyless || keySet)
      const statusStyle = { fontSize: '13px', lineHeight: '18px', margin: '0 0 12px', color: backendReady ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' }

      return react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px' } }, [
        react.createElement('p', { key: 'status', style: statusStyle },
          backendReady
            ? `✓ 后端就绪：${preset.label}（${form.model || '—'}）`
            : preset.keyless
              ? '未就绪：model / baseUrl 未填（此预设免 key，直接保存即可）'
              : '未就绪：选择预设并填写 API key 后保存'),
        react.createElement(Field, {
          key: 'provider', tag: 'select', label: '预设（VLM 后端）', value: form.provider,
          options: PRESET_OPTIONS, onChange: onProvider,
        }),
        react.createElement(Field, {
          key: 'apiKey', label: `API key ${keySet ? '（已保存，重新输入可覆盖）' : ''}`, type: 'password',
          value: apiKeyInput, placeholder: keyEnvHint, onChange: setApiKeyInput,
        }),
        react.createElement('details', { key: 'adv' }, [
          react.createElement('summary', { key: 's', style: { cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, '高级（model / baseUrl / 类型 / 超时）'),
          react.createElement(Field, { key: 'model', label: '模型名', value: form.model, onChange: (model) => setForm((p) => ({ ...p, model })) }),
          react.createElement(Field, { key: 'baseUrl', label: 'Base URL', value: form.baseUrl, onChange: (baseUrl) => setForm((p) => ({ ...p, baseUrl })) }),
          react.createElement(Field, {
            key: 'apiType', tag: 'select', label: 'API 类型', value: form.apiType,
            options: [{ id: 'openai', label: 'openai（OpenAI 兼容 /chat/completions）' }, { id: 'minimax', label: 'minimax（原生 VLM 端点）' }],
            onChange: (apiType) => setForm((p) => ({ ...p, apiType })),
          }),
          react.createElement(Field, { key: 'timeoutMs', label: '超时 timeoutMs（每请求）', value: form.timeoutMs, onChange: (timeoutMs) => setForm((p) => ({ ...p, timeoutMs })) }),
          react.createElement(Field, { key: 'maxTokens', label: 'maxTokens', value: form.maxTokens, onChange: (maxTokens) => setForm((p) => ({ ...p, maxTokens })) }),
        ]),
        react.createElement('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          react.createElement('button', { key: 'save', style: saving ? buttonDisabled : buttonStyle, disabled: saving, onClick: save }, saving ? '保存中…' : '保存'),
          react.createElement('button', {
            key: 'refresh', disabled: loading || saving, onClick: refresh,
            style: { cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(128,128,128,0.4))', borderRadius: '8px', padding: '4px 10px', fontSize: '13px', background: 'transparent', color: 'inherit' },
          }, '刷新'),
          loading ? react.createElement('span', { key: 'loading', style: hintStyle }, '加载中…') : null,
        ]),
        error !== null
          ? react.createElement('p', { key: 'error', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', whiteSpace: 'pre-wrap', margin: 0 } }, error)
          : null,
        saved !== null
          ? react.createElement('p', { key: 'saved', style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '13px', margin: 0 } }, saved)
          : null,
        react.createElement('p', { key: 'note', style: hintStyle },
          '免 key 方案：OpenCode Zen 免费层（免注册但高峰期可能限流）或本地 Ollama（ollama run qwen2.5vl:7b 后直接可用）。其他预设均为免费额度/低价，只需对应平台的注册 key。粘贴图片时 dsh-sight 会先把图片存到本地并注入路径提示，文本模型随后调用 vision 工具读取。多图可一次传：vision(paths=[a.png, b.png])。'),
      ])
    }

    const inject = ['slots', 'connection']

    function apply(ctx) {
      const connection = ctx.get('connection')
      const api = connection === null || connection === undefined ? undefined : connection.api
      if (api === undefined) return
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-sight',
        order: 12,
        label: () => '视觉模型',
        inject: () => ({ api }),
      }, DshSightSection))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
