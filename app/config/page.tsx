'use client'

import { useState, useEffect } from 'react'

type Properties = Record<string, string>

const COMMON_SETTINGS = [
  { key: 'motd', label: 'Server Description (MOTD)', type: 'text' },
  { key: 'gamemode', label: 'Default Game Mode', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'max-players', label: 'Max Players', type: 'number' },
  { key: 'level-seed', label: 'World Seed', type: 'text', note: 'Only affects new world generation' },
  { key: 'level-name', label: 'World Name (Folder)', type: 'text' },
  { key: 'level-type', label: 'World Type', type: 'select', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified'] },
  { key: 'pvp', label: 'PvP', type: 'boolean' },
  { key: 'online-mode', label: 'Online Mode (Premium players only)', type: 'boolean' },
  { key: 'spawn-animals', label: 'Spawn Animals', type: 'boolean' },
  { key: 'spawn-monsters', label: 'Spawn Monsters', type: 'boolean' },
  { key: 'spawn-npcs', label: 'Spawn Villagers (NPCs)', type: 'boolean' },
  { key: 'view-distance', label: 'View Distance (chunks)', type: 'number' },
  { key: 'simulation-distance', label: 'Simulation Distance (chunks)', type: 'number' },
  { key: 'server-port', label: 'Server Port', type: 'number' },
  { key: 'allow-flight', label: 'Allow Flight', type: 'boolean' },
  { key: 'white-list', label: 'Enable Whitelist', type: 'boolean' },
] as const

export default function ConfigPage() {
  const [props, setProps] = useState<Properties>({})
  const [rawText, setRawText] = useState('')
  const [activeTab, setActiveTab] = useState<'visual' | 'raw'>('visual')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProps(data.properties as Properties)
          setRawText(
            Object.entries(data.properties as Properties)
              .map(([k, v]) => `${k}=${v}`)
              .join('\n')
          )
        } else {
          setMessage({ text: data.message, ok: false })
        }
      })
      .catch(() => setMessage({ text: 'Failed to load configuration', ok: false }))
      .finally(() => setLoading(false))
  }, [])

  const setProp = (key: string, value: string) => {
    setProps((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)

    let payload: Properties = {}

    if (activeTab === 'raw') {
      for (const line of rawText.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx === -1) continue
        payload[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1)
      }
    } else {
      payload = { ...props }
    }

    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: payload }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
    } catch {
      setMessage({ text: 'Failed to save configuration', ok: false })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3 text-zinc-500">
        <span className="animate-spin">⟳</span> Loading configuration...
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-zinc-100">Configuration</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden text-sm">
            {(['visual', 'raw'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  if (tab === 'raw' && activeTab === 'visual') {
                    setRawText(
                      Object.entries(props)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('\n')
                    )
                  }
                  setActiveTab(tab)
                }}
                className={`px-4 py-2 transition-colors ${
                  activeTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab === 'visual' ? 'Visual' : 'Raw Editor'}
              </button>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm mb-5 border ${
            message.ok
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          {message.text}
        </div>
      )}

      {activeTab === 'visual' ? (
        <div className="space-y-3">
          {COMMON_SETTINGS.map(({ key, label, type, ...rest }) => {
            const note = 'note' in rest ? rest.note : undefined
            const options = 'options' in rest ? rest.options : undefined

            return (
              <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <label className="block text-sm font-medium text-zinc-200 mb-0.5">
                  {label}
                  {note && <span className="text-zinc-500 font-normal text-xs ml-2">({note})</span>}
                </label>
                <p className="text-zinc-600 text-xs font-mono mb-2">{key}</p>

                {type === 'select' && options ? (
                  <select
                    value={props[key] ?? ''}
                    onChange={(e) => setProp(key, e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    {(options as readonly string[]).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : type === 'boolean' ? (
                  <div className="flex gap-4">
                    {['true', 'false'].map((val) => (
                      <label key={val} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={key}
                          value={val}
                          checked={(props[key] ?? 'false') === val}
                          onChange={() => setProp(key, val)}
                          className="accent-emerald-500"
                        />
                        <span className="text-sm text-zinc-300">{val}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    type={type}
                    value={props[key] ?? ''}
                    onChange={(e) => setProp(key, e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          className="w-full min-h-150 bg-zinc-900 border border-zinc-800 rounded-xl p-4 font-mono text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 resize-none transition-colors"
          spellCheck={false}
          placeholder="key=value"
        />
      )}

      <p className="mt-4 text-zinc-600 text-xs">
        Restart the server after saving for all changes to take effect.
      </p>
    </div>
  )
}
