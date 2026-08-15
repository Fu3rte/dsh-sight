// Web settings page (settings.section slot), built from host design-system
// atoms so controls follow the theme. The API key is `role('secret')` — the
// input is write-only; a stored key renders as empty. CLIENT_PRESETS mirrors
// lib/presets.js (client bundles can't import the server module) — keep in
// sync when presets change. `custom` is a client-only row: the server treats
// an unknown provider as "no preset" and resolves model/baseUrl/apiKey from
// the explicit fields (see lib/config.js deriveConfig).

window.__ModuleLoader__.load({
  id: 'dsh-sight',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const { useEffect, useState } = react
    const { Menu, Input, Button, IconChevronDownOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dsh-sight'

    const CLIENT_PRESETS = {
      'opencode-zen': {
        label: 'OpenCode Zen · 免费 · 免 key',
        model: 'mimo-v2.5-free',
        baseUrl: 'https://opencode.ai/zen/v1',
        keyless: true,
        keyEnv: null,
      },
      'gemini-flash': {
        label: 'Gemini Flash · 免费额度 · 需 key',
        model: 'gemini-3.6-flash',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        keyless: false,
        keyEnv: 'GEMINI_API_KEY',
      },
      custom: {
        label: '自定义端点（OpenAI 兼容）',
        model: '',
        baseUrl: '',
        keyless: false,
        keyEnv: 'DSH_SIGHT_API_KEY',
      },
    }

    const PRESET_OPTIONS = Object.keys(CLIENT_PRESETS).map((id) => ({ id, label: CLIENT_PRESETS[id].label }))

    const MODE_HINTS = {
      'opencode-zen': '免费公共端点，无需 API key。模型名与 Base URL 已自动填入，一般不需要改动。',
      'gemini-flash': 'Google AI Studio 免费额度。模型名与 Base URL 已自动填入，需要填写 API key。',
      custom: '连接你自己的 OpenAI 兼容端点（如阿里云百炼 Qwen）。模型名、Base URL、API key 均需填写。',
    }

    const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' }
    const fieldStyle = { marginBottom: '12px' }
    const triggerStyle = {
      cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      padding: '7px 10px', fontSize: '14px', color: 'inherit', textAlign: 'left',
      background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
      border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(128,128,128,0.4))', borderRadius: '8px',
    }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '20px', margin: 0 }
    const monoStyle = {
      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, Consolas, monospace)',
      fontSize: '12px', overflowWrap: 'anywhere',
    }
    const cardStyle = {
      border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(128,128,128,0.4))',
      borderRadius: '8px', padding: '10px 12px', marginBottom: '12px',
      background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
    }
    const cardRowStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '4px' }
    const cardKeyStyle = { flex: '0 0 auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' }
    const noticeStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap',
      border: '1px solid var(--dsw-alias-state-warning-primary, #d9a13b)', borderRadius: '8px',
      padding: '8px 12px', marginBottom: '12px', fontSize: '13px', lineHeight: '18px',
      color: 'var(--dsw-alias-state-warning-primary, #d9a13b)', background: 'transparent',
    }

    function Field(props) {
      return react.createElement('div', { style: fieldStyle }, [
        react.createElement('label', { key: 'l', style: labelStyle }, props.label),
        props.children,
      ])
    }

    function MenuField(props) {
      const [open, setOpen] = useState(false)
      return react.createElement(Menu, {
        open,
        onClose: () => setOpen(false),
        items: props.options,
        selectedId: props.value,
        onSelect: (id) => {
          setOpen(false)
          props.onChange(id)
        },
        portal: true,
        anchor: react.createElement('button', {
          type: 'button',
          style: triggerStyle,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        }, [
          react.createElement('span', { key: 'label', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (props.options.find((o) => o.id === props.value) || props.options[0]).label),
          react.createElement(IconChevronDownOutline14, { key: 'chevron' }),
        ]),
      })
    }

    function hostOf(baseUrl) {
      if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return null
      try {
        return new URL(baseUrl).host
      } catch {
        return baseUrl
      }
    }

    function DshSightSection(props) {
      const api = props.api
      const [form, setForm] = useState({ provider: 'opencode-zen', model: '', baseUrl: '', timeoutMs: '120000', maxTokens: '4096' })
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
            provider: typeof value.provider === 'string' && CLIENT_PRESETS[value.provider] ? value.provider : 'custom',
            model: typeof value.model === 'string' ? value.model : '',
            baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
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
          ...(preset !== undefined && preset.model !== '' && preset.baseUrl !== '' ? { model: preset.model, baseUrl: preset.baseUrl } : {}),
        }))
        setSaved(null)
      }

      const switchToCustom = () => {
        setForm((prev) => ({ ...prev, provider: 'custom' }))
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
          if (form.provider === 'custom') {
            if (form.model.trim() === '') throw new Error('自定义端点需要填写模型名')
            if (form.baseUrl.trim() === '') throw new Error('自定义端点需要填写 Base URL')
          }
          const patch = {
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
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

      // Derive the effective backend the server will actually use (mirrors
      // lib/config.js deriveConfig: explicit fields win over preset defaults).
      const mode = CLIENT_PRESETS[form.provider] !== undefined ? form.provider : 'custom'
      const preset = CLIENT_PRESETS[mode]
      const keyless = preset.keyless === true
      const isPreset = mode !== 'custom'
      const presetDefined = isPreset && preset.model !== '' && preset.baseUrl !== ''
      const override = presetDefined && (form.model !== preset.model || form.baseUrl !== preset.baseUrl)
      const host = hostOf(form.baseUrl)
      const modelFilled = form.model.trim() !== ''
      const urlFilled = form.baseUrl.trim() !== ''
      const keyAvailable = keyless || keySet || apiKeyInput !== ''
      const backendReady = modelFilled && urlFilled && keyAvailable
      const showKeyField = mode === 'custom' || mode === 'gemini-flash' || override

      const keyHint = mode === 'gemini-flash'
        ? '留空则使用环境变量 GEMINI_API_KEY / DSH_SIGHT_API_KEY 中已有的 key'
        : '留空则沿用已保存的 key 或环境变量 DSH_SIGHT_API_KEY'

      const statusColor = backendReady
        ? 'var(--dsw-alias-state-success-primary)'
        : (modelFilled && urlFilled && !keyAvailable)
          ? 'var(--dsw-alias-state-warning-primary, #d9a13b)'
          : 'var(--dsw-alias-label-secondary)'

      const statusText = backendReady
        ? `✓ 后端就绪：${form.model || '—'} @ ${host ?? form.baseUrl ?? '—'}`
        : (!modelFilled || !urlFilled)
          ? '未就绪：模型名 / Base URL 未填写'
          : keyless
            ? '未就绪：模型名 / Base URL 未填写'
            : '未就绪：缺少 API key（可填写后保存，或依赖环境变量）'

      return react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px' } }, [
        // ── Backend source ─────────────────────────────────────────────
        react.createElement(Field, { key: 'provider', label: '后端来源' }, [
          react.createElement(MenuField, { key: 'm', value: mode, options: PRESET_OPTIONS, onChange: onProvider }),
        ]),
        react.createElement('p', { key: 'modeHint', style: hintStyle }, MODE_HINTS[mode] ?? ''),

        // ── Effective backend preview ──────────────────────────────────
        react.createElement('div', { key: 'preview', style: cardStyle }, [
          react.createElement('p', { key: 't', style: { ...labelStyle, marginBottom: '6px' } }, '生效配置（实际请求目标）'),
          react.createElement('div', { key: 'r1', style: cardRowStyle }, [
            react.createElement('span', { key: 'k', style: cardKeyStyle }, '模型'),
            react.createElement('span', { key: 'v', style: monoStyle }, form.model || '—'),
          ]),
          react.createElement('div', { key: 'r2', style: cardRowStyle }, [
            react.createElement('span', { key: 'k', style: cardKeyStyle }, '端点'),
            react.createElement('span', { key: 'v', style: { ...monoStyle, textAlign: 'right' } }, host ?? (form.baseUrl || '—')),
          ]),
          react.createElement('div', { key: 'r3', style: cardRowStyle }, [
            react.createElement('span', { key: 'k', style: cardKeyStyle }, '密钥'),
            react.createElement('span', { key: 'v', style: hintStyle },
              keyless && !override ? '免 key' : keySet ? '已保存' : apiKeyInput !== '' ? '本次保存后生效' : '未填写'),
          ]),
          react.createElement('p', { key: 's', style: { ...hintStyle, margin: '6px 0 0', color: statusColor } }, statusText),
        ]),

        // ── Override notice (preset selected but custom endpoint filled) ─
        override
          ? react.createElement('div', { key: 'override', style: noticeStyle }, [
              react.createElement('span', { key: 't' },
                `⚠ 模型 / Base URL 与「${preset.label}」的预设默认值不同，实际请求将发往你填写的端点，而不是该预设。`),
              react.createElement(Button, { key: 'b', variant: 'outline', onClick: switchToCustom }, '转为自定义端点'),
            ])
          : null,

        // ── Endpoint fields ────────────────────────────────────────────
        react.createElement(Field, {
          key: 'model',
          label: presetDefined && !override ? '模型名（预设默认值）' : presetDefined && override ? '模型名（已覆盖预设）' : '模型名',
        }, [
          react.createElement(Input, { key: 'i', value: form.model, placeholder: '如 qwen3-vl-plus / gpt-4o-mini', onChange: (event) => setForm((p) => ({ ...p, model: event.target.value })) }),
        ]),
        react.createElement(Field, {
          key: 'baseUrl',
          label: presetDefined && override ? 'Base URL（已覆盖预设）' : 'Base URL',
        }, [
          react.createElement(Input, {
            key: 'i', value: form.baseUrl,
            placeholder: 'https://example.com/v1（OpenAI 兼容端点）',
            onChange: (event) => setForm((p) => ({ ...p, baseUrl: event.target.value })),
          }),
        ]),

        // ── API key ────────────────────────────────────────────────────
        showKeyField
          ? react.createElement(Field, { key: 'apiKey', label: `API key ${keySet ? '（已保存，重新输入可覆盖）' : ''}` }, [
              react.createElement(Input, { key: 'i', type: 'password', value: apiKeyInput, placeholder: keyHint, onChange: (event) => setApiKeyInput(event.target.value) }),
            ])
          : null,

        // ── Advanced ───────────────────────────────────────────────────
        react.createElement('details', { key: 'adv' }, [
          react.createElement('summary', { key: 's', style: { cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, '高级参数'),
          react.createElement('div', { key: 'body', style: { marginTop: '10px' } }, [
            react.createElement(Field, { key: 'timeoutMs', label: '超时 timeoutMs（每次请求，毫秒）' }, [
              react.createElement(Input, { key: 'i', value: form.timeoutMs, onChange: (event) => setForm((p) => ({ ...p, timeoutMs: event.target.value })) }),
            ]),
            react.createElement(Field, { key: 'maxTokens', label: 'maxTokens（单次回复上限）' }, [
              react.createElement(Input, { key: 'i', value: form.maxTokens, onChange: (event) => setForm((p) => ({ ...p, maxTokens: event.target.value })) }),
            ]),
          ]),
        ]),

        // ── Actions & status ───────────────────────────────────────────
        react.createElement('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
          react.createElement(Button, { key: 'save', variant: 'primary', disabled: saving, onClick: save }, saving ? '保存中…' : '保存'),
          react.createElement(Button, { key: 'refresh', variant: 'outline', disabled: loading || saving, onClick: refresh }, '刷新'),
          loading ? react.createElement('span', { key: 'loading', style: hintStyle }, '加载中…') : null,
        ]),
        error !== null
          ? react.createElement('p', { key: 'error', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', whiteSpace: 'pre-wrap', margin: 0 } }, error)
          : null,
        saved !== null
          ? react.createElement('p', { key: 'saved', style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '13px', margin: 0 } }, saved)
          : null,
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
