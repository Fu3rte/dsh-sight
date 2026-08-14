// Web settings page (settings.section slot), built from host design-system
// atoms so controls follow the theme. The API key is `role('secret')` — the
// input is write-only; a stored key renders as empty. CLIENT_PRESETS mirrors
// lib/presets.js (client bundles can't import the server module) — keep in
// sync when presets change.

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
      'opencode-zen': { label: 'OpenCode Zen', model: 'mimo-v2.5-free', baseUrl: 'https://opencode.ai/zen/v1', keyless: true, keyEnv: null },
      'gemini-flash': { label: 'Gemini Flash — Google AI Studio', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyless: false, keyEnv: 'GEMINI_API_KEY' },
    }

    const PRESET_OPTIONS = Object.keys(CLIENT_PRESETS).map((id) => ({
      id,
      label: (CLIENT_PRESETS[id].keyless ? '免 key · ' : '') + CLIENT_PRESETS[id].label,
    }))

    const labelStyle = { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' }
    const fieldStyle = { marginBottom: '12px' }
    const triggerStyle = {
      cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      padding: '7px 10px', fontSize: '14px', color: 'inherit', textAlign: 'left',
      background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
      border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(128,128,128,0.4))', borderRadius: '8px',
    }
    const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '20px', margin: 0 }

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
            provider: typeof value.provider === 'string' && CLIENT_PRESETS[value.provider] ? value.provider : 'opencode-zen',
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
          ...(preset ? { model: preset.model, baseUrl: preset.baseUrl } : {}),
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

      const preset = CLIENT_PRESETS[form.provider] ?? CLIENT_PRESETS['opencode-zen']
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
        react.createElement(Field, { key: 'provider', label: '预设（VLM 后端）' }, [
          react.createElement(MenuField, { key: 'm', value: form.provider, options: PRESET_OPTIONS, onChange: onProvider }),
        ]),
        react.createElement(Field, { key: 'apiKey', label: `API key ${keySet ? '（已保存，重新输入可覆盖）' : ''}` }, [
          react.createElement(Input, { key: 'i', type: 'password', value: apiKeyInput, placeholder: keyEnvHint, onChange: (event) => setApiKeyInput(event.target.value) }),
        ]),
        react.createElement('details', { key: 'adv' }, [
          react.createElement('summary', { key: 's', style: { cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, '高级（model / baseUrl / 类型 / 超时）'),
          react.createElement(Field, { key: 'model', label: '模型名' }, [
            react.createElement(Input, { key: 'i', value: form.model, onChange: (event) => setForm((p) => ({ ...p, model: event.target.value })) }),
          ]),
          react.createElement(Field, { key: 'baseUrl', label: 'Base URL' }, [
            react.createElement(Input, { key: 'i', value: form.baseUrl, onChange: (event) => setForm((p) => ({ ...p, baseUrl: event.target.value })) }),
          ]),
          react.createElement(Field, { key: 'timeoutMs', label: '超时 timeoutMs（每请求）' }, [
            react.createElement(Input, { key: 'i', value: form.timeoutMs, onChange: (event) => setForm((p) => ({ ...p, timeoutMs: event.target.value })) }),
          ]),
          react.createElement(Field, { key: 'maxTokens', label: 'maxTokens' }, [
            react.createElement(Input, { key: 'i', value: form.maxTokens, onChange: (event) => setForm((p) => ({ ...p, maxTokens: event.target.value })) }),
          ]),
        ]),
        react.createElement('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
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
