'use client'

import { useState, useEffect, useRef } from 'react'

interface Plugin {
  name: string
  size: number
  modified: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchPlugins = async () => {
    try {
      const res = await fetch('/api/plugins')
      const data = await res.json()
      if (data.success) setPlugins(data.plugins as Plugin[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlugins()
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.jar')) {
      setMessage({ text: 'Only .jar files are allowed', ok: false })
      return
    }

    setUploading(true)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/plugins', { method: 'POST', body: formData })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) await fetchPlugins()
    } catch {
      setMessage({ text: 'Upload failed', ok: false })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete ${name}? This action cannot be undone.`)) return

    try {
      const res = await fetch('/api/plugins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) await fetchPlugins()
    } catch {
      setMessage({ text: 'Delete failed', ok: false })
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Plugins</h1>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jar"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            {uploading ? 'Uploading…' : '+ Upload Plugin'}
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

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading plugins...</p>
      ) : plugins.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-4xl mb-3">🧩</p>
          <p className="text-base font-medium mb-1">No plugins installed</p>
          <p className="text-sm">Upload a .jar file to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-zinc-100 text-sm font-medium truncate">{plugin.name}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {formatSize(plugin.size)} &middot; {new Date(plugin.modified).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(plugin.name)}
                className="ml-4 shrink-0 text-red-500 hover:text-red-400 text-sm transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-zinc-600 text-xs">
        Restart the server after adding or removing plugins for changes to take effect.
      </p>
    </div>
  )
}
