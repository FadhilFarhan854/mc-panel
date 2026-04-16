'use client'

import { useState, useEffect, useCallback } from 'react'

interface WhitelistEntry {
  uuid: string
  name: string
}

interface BanEntry {
  uuid: string
  name: string
  created: string
  source: string
  expires: string
  reason: string
}

export default function PlayersPage() {
  const [activeTab, setActiveTab] = useState<'whitelist' | 'banned'>('whitelist')
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([])
  const [banned, setBanned] = useState<BanEntry[]>([])
  const [inputName, setInputName] = useState('')
  const [banReason, setBanReason] = useState('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let active = true
    Promise.all([fetch('/api/players/whitelist'), fetch('/api/players/banned')])
      .then(([wlRes, blRes]) => Promise.all([wlRes.json(), blRes.json()]))
      .then(([wl, bl]) => {
        if (!active) return
        if (wl.success) setWhitelist(wl.players as WhitelistEntry[])
        if (bl.success) setBanned(bl.players as BanEntry[])
      })
      .catch(() => {
        if (active) setMessage({ text: 'Failed to load player data', ok: false })
      })
    return () => {
      active = false
    }
  }, [refreshKey])

  const clearMessage = () => setMessage(null)

  const handleAddWhitelist = async () => {
    if (!inputName.trim()) return
    clearMessage()
    try {
      const res = await fetch('/api/players/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inputName.trim() }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) {
        setInputName('')
        refresh()
      }
    } catch {
      setMessage({ text: 'Request failed', ok: false })
    }
  }

  const handleRemoveWhitelist = async (name: string) => {
    clearMessage()
    try {
      const res = await fetch('/api/players/whitelist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) refresh()
    } catch {
      setMessage({ text: 'Request failed', ok: false })
    }
  }

  const handleBan = async () => {
    if (!inputName.trim()) return
    clearMessage()
    try {
      const res = await fetch('/api/players/banned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inputName.trim(), reason: banReason.trim() || undefined }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) {
        setInputName('')
        setBanReason('')
        refresh()
      }
    } catch {
      setMessage({ text: 'Request failed', ok: false })
    }
  }

  const handleUnban = async (name: string) => {
    clearMessage()
    try {
      const res = await fetch('/api/players/banned', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) refresh()
    } catch {
      setMessage({ text: 'Request failed', ok: false })
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Players</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit mb-6">
        {(['whitelist', 'banned'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); clearMessage(); setInputName('') }}
            className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab === 'whitelist' ? `Whitelist (${whitelist.length})` : `Banned (${banned.length})`}
          </button>
        ))}
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

      {/* Whitelist Tab */}
      {activeTab === 'whitelist' && (
        <>
          <div className="flex gap-2 mb-5">
            <input
              type="text"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddWhitelist()}
              placeholder="Player username"
              maxLength={16}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <button
              onClick={handleAddWhitelist}
              disabled={!inputName.trim()}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Add
            </button>
          </div>

          {whitelist.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-10">Whitelist is empty</p>
          ) : (
            <div className="space-y-2">
              {whitelist.map((p) => (
                <div
                  key={p.uuid || p.name}
                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
                >
                  <span className="text-zinc-100 text-sm">{p.name}</span>
                  <button
                    onClick={() => handleRemoveWhitelist(p.name)}
                    className="text-red-500 hover:text-red-400 text-sm transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Banned Tab */}
      {activeTab === 'banned' && (
        <>
          <div className="flex flex-col gap-2 mb-5">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                placeholder="Player username"
                maxLength={16}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Ban reason (optional)"
                maxLength={100}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
              />
              <button
                onClick={handleBan}
                disabled={!inputName.trim()}
                className="px-5 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                Ban
              </button>
            </div>
            <p className="text-zinc-600 text-xs">Server must be online to ban or unban players.</p>
          </div>

          {banned.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-10">No banned players</p>
          ) : (
            <div className="space-y-2">
              {banned.map((p) => (
                <div
                  key={p.uuid || p.name}
                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
                >
                  <div>
                    <p className="text-zinc-100 text-sm">{p.name}</p>
                    {p.reason && (
                      <p className="text-zinc-500 text-xs mt-0.5">Reason: {p.reason}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnban(p.name)}
                    className="ml-4 text-emerald-500 hover:text-emerald-400 text-sm transition-colors"
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
