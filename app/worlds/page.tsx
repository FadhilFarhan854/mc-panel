'use client'

import { useState, useEffect, useRef } from 'react'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [worldName, setWorldName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchWorlds = async () => {
    try {
      const res = await fetch('/api/worlds')
      const data = await res.json()
      if (data.success) setWorlds(data.worlds as string[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorlds()
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.zip') && !file.name.endsWith('.tar.gz')) {
      setMessage({ text: 'Only .zip or .tar.gz files are supported', ok: false })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFile(file)
    // Derive default world name from filename
    const base = file.name.replace(/\.tar\.gz$/, '').replace(/\.zip$/, '')
    setWorldName(base)
    setMessage(null)
  }

  const handleImport = async () => {
    if (!selectedFile) return
    setImporting(true)
    setMessage(null)

    const formData = new FormData()
    formData.append('file', selectedFile)
    if (worldName.trim()) formData.append('worldName', worldName.trim())

    try {
      const res = await fetch('/api/worlds', { method: 'POST', body: formData })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) {
        setSelectedFile(null)
        setWorldName('')
        if (fileInputRef.current) fileInputRef.current.value = ''
        await fetchWorlds()
      }
    } catch {
      setMessage({ text: 'Import failed', ok: false })
    } finally {
      setImporting(false)
    }
  }

  const cancelImport = () => {
    setSelectedFile(null)
    setWorldName('')
    setMessage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Worlds</h1>
        {!selectedFile && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar.gz"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium transition-colors"
            >
              + Import World
            </button>
          </div>
        )}
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

      {/* Import form */}
      {selectedFile && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 mb-6">
          <p className="text-sm text-zinc-400 mb-3">
            <span className="text-zinc-200 font-medium">File:</span> {selectedFile.name}
            <span className="ml-3 text-zinc-500">({formatSize(selectedFile.size)})</span>
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">World Name</label>
              <input
                type="text"
                value={worldName}
                onChange={(e) => setWorldName(e.target.value)}
                placeholder="Derived from archive name"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={cancelImport}
              disabled={importing}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading worlds...</p>
      ) : worlds.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-4xl mb-3">🌍</p>
          <p className="text-base font-medium mb-1">No worlds found</p>
          <p className="text-sm">Import a world archive to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {worlds.map((world) => (
            <div
              key={world}
              className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
            >
              <p className="text-zinc-100 text-sm font-medium truncate">{world}</p>
              <a
                href={`/api/worlds/${encodeURIComponent(world)}/download`}
                download
                className="ml-4 shrink-0 text-emerald-400 hover:text-emerald-300 text-sm transition-colors"
              >
                Download
              </a>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-zinc-600 text-xs">
        Stop the server before importing a world to avoid data corruption. Supports .zip and .tar.gz archives.
      </p>
    </div>
  )
}
