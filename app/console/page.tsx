'use client'

import { useState, useEffect, useRef } from 'react'

export default function ConsolePage() {
  const [lines, setLines] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  useEffect(() => {
    const evtSource = new EventSource('/api/console')

    evtSource.onmessage = (e) => {
      const line = JSON.parse(e.data) as string
      setLines((prev) => [...prev.slice(-999), line])
    }

    evtSource.onerror = () => {
      // EventSource auto-reconnects on error
    }

    return () => evtSource.close()
  }, [])

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [lines])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!command.trim()) return

    setSending(true)
    try {
      await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command.trim() }),
      })
      setCommand('')
    } finally {
      setSending(false)
    }
  }

  const getLineClass = (line: string): string => {
    if (line.startsWith('> ')) return 'text-emerald-400'
    if (line.startsWith('[Panel]')) return 'text-yellow-400'
    if (/\b(error|exception|fatal|crash)\b/i.test(line)) return 'text-red-400'
    if (/\b(warn|warning)\b/i.test(line)) return 'text-yellow-300'
    if (line.includes('[INFO]') || line.includes('INFO]')) return 'text-zinc-300'
    return 'text-zinc-400'
  }

  return (
    <div className="flex flex-col h-screen p-6 gap-4">
      <h1 className="text-2xl font-bold text-zinc-100 shrink-0">Console</h1>

      <div
        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-y-auto p-4 font-mono text-xs min-h-0"
        onScroll={(e) => {
          const el = e.currentTarget
          autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {lines.length === 0 && (
          <span className="text-zinc-600">Waiting for server output...</span>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${getLineClass(line)}`}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 shrink-0">
        <div className="flex-1 flex items-center bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors">
          <span className="pl-4 text-emerald-400 font-mono text-sm select-none">&gt;</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="say Hello World"
            disabled={sending}
            autoComplete="off"
            className="flex-1 bg-transparent px-3 py-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={sending || !command.trim()}
          className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  )
}
