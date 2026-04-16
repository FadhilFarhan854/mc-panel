'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type ServerStatus = 'offline' | 'starting' | 'online' | 'stopping'

interface ServerInfo {
  status: ServerStatus
  recentLogs: string[]
}

const STATUS_CONFIG: Record<
  ServerStatus,
  { label: string; dotClass: string; cardClass: string; textClass: string }
> = {
  online:   { label: 'ONLINE',   dotClass: 'bg-emerald-400',              textClass: 'text-emerald-400', cardClass: 'border-emerald-500/30 bg-emerald-500/5' },
  offline:  { label: 'OFFLINE',  dotClass: 'bg-red-400',                  textClass: 'text-red-400',     cardClass: 'border-red-500/30 bg-red-500/5' },
  starting: { label: 'STARTING', dotClass: 'bg-yellow-400 animate-pulse', textClass: 'text-yellow-400',  cardClass: 'border-yellow-500/30 bg-yellow-500/5' },
  stopping: { label: 'STOPPING', dotClass: 'bg-orange-400 animate-pulse', textClass: 'text-orange-400',  cardClass: 'border-orange-500/30 bg-orange-500/5' },
}

export default function DashboardPage() {
  const [info, setInfo] = useState<ServerInfo>({ status: 'offline', recentLogs: [] })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/server')
      const data = await res.json()
      setInfo(data)
    } catch {
      // Will retry on next interval
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => {
      clearInterval(interval)
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
    }
  }, [fetchStatus])

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setLoading(true)
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current)
    setMessage('')
    try {
      const res = await fetch('/api/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      setMessage(data.message)
      messageTimerRef.current = setTimeout(() => setMessage(''), 6000)
      await fetchStatus()
    } catch {
      setMessage('Request failed — check server connection')
    } finally {
      setLoading(false)
    }
  }

  const cfg = STATUS_CONFIG[info.status]

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Dashboard</h1>

      {/* Status & Controls */}
      <div className={`rounded-xl border p-6 mb-4 ${cfg.cardClass}`}>
        <div className="flex items-center gap-3 mb-5">
          <span className={`w-3 h-3 rounded-full shrink-0 ${cfg.dotClass}`} />
          <span className={`text-2xl font-bold tracking-widest ${cfg.textClass}`}>{cfg.label}</span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleAction('start')}
            disabled={loading || info.status !== 'offline'}
            className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm transition-colors"
          >
            Start
          </button>
          <button
            onClick={() => handleAction('stop')}
            disabled={loading || info.status !== 'online'}
            className="px-5 py-2 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm transition-colors"
          >
            Stop
          </button>
          <button
            onClick={() => handleAction('restart')}
            disabled={loading || info.status === 'starting' || info.status === 'stopping'}
            className="px-5 py-2 rounded-lg bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm transition-colors"
          >
            Restart
          </button>
        </div>

        {message && (
          <p className="mt-4 text-sm text-zinc-300 bg-zinc-900/60 rounded-lg px-3 py-2">{message}</p>
        )}
      </div>

      {/* Recent Logs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Recent Activity</h2>
        {info.recentLogs.length === 0 ? (
          <p className="text-zinc-600 text-sm">No log entries yet. Start the server to see output here.</p>
        ) : (
          <div className="font-mono text-xs space-y-0.5 overflow-hidden">
            {info.recentLogs.map((line, i) => (
              <div key={i} className="text-zinc-400 truncate">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
