'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type PackType = 'resource' | 'behavior'

interface Pack {
  name: string
  uuid: string
  version: number[]
  active: boolean
}

const PACK_META: Record<PackType, { label: string; description: string; color: string }> = {
  resource: {
    label: 'Resource Packs',
    description: 'Textures, sounds, and UI changes',
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  },
  behavior: {
    label: 'Behavior Packs',
    description: 'Game logic, entities, and loot tables',
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  },
}

export default function AddonsPage() {
  const [packs, setPacks] = useState<Record<PackType, Pack[]>>({ resource: [], behavior: [] })
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState<PackType>('resource')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragItem = useRef<{ type: PackType; index: number } | null>(null)
  const dragOver = useRef<number | null>(null)

  const fetchPacks = async () => {
    try {
      const res = await fetch('/api/addons')
      const data = await res.json()
      if (data.success) setPacks(data.packs as Record<PackType, Pack[]>)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPacks()
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.mcpack') && !file.name.endsWith('.mcaddon')) {
      setMessage({ text: 'Only .mcpack or .mcaddon files are allowed', ok: false })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploading(true)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', uploadType)

    try {
      const res = await fetch('/api/addons', { method: 'POST', body: formData })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) await fetchPacks()
    } catch {
      setMessage({ text: 'Upload failed', ok: false })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleReorder = useCallback(async (type: PackType, newOrder: Pack[]) => {
    setPacks((prev) => ({ ...prev, [type]: newOrder }))
    await fetch('/api/addons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, uuids: newOrder.map((p) => p.uuid) }),
    })
  }, [])

  const handleDragStart = (type: PackType, index: number) => {
    dragItem.current = { type, index }
  }

  const handleDragEnter = (index: number) => {
    dragOver.current = index
  }

  const handleDragEnd = (type: PackType) => {
    if (dragItem.current === null || dragOver.current === null) return
    if (dragItem.current.index === dragOver.current) return
    const updated = [...packs[type]]
    const [moved] = updated.splice(dragItem.current.index, 1)
    updated.splice(dragOver.current, 0, moved)
    dragItem.current = null
    dragOver.current = null
    handleReorder(type, updated)
  }

  const handleToggle = async (uuid: string, type: PackType) => {
    try {
      const res = await fetch('/api/addons', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, type }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) await fetchPacks()
    } catch {
      setMessage({ text: 'Toggle failed', ok: false })
    }
  }

  const handleDelete = async (uuid: string, name: string, type: PackType) => {
    if (!confirm(`Delete ${name}? This action cannot be undone.`)) return

    try {
      const res = await fetch('/api/addons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, type }),
      })
      const data = await res.json()
      setMessage({ text: data.message, ok: data.success })
      if (data.success) await fetchPacks()
    } catch {
      setMessage({ text: 'Delete failed', ok: false })
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3 text-zinc-500">
        <span className="animate-spin">⟳</span> Loading addons...
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-zinc-100">Addons</h1>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
          Bedrock Edition
        </span>
      </div>
      <p className="text-zinc-500 text-sm mb-6">
        Upload <code className="text-zinc-400">.mcpack</code> or <code className="text-zinc-400">.mcaddon</code> files.
        Packs are automatically extracted and activated. Restart the server after uploading.
      </p>

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

      {/* Upload */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Upload Pack</h2>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden text-sm shrink-0">
            {(['resource', 'behavior'] as PackType[]).map((t) => (
              <button
                key={t}
                onClick={() => setUploadType(t)}
                className={`px-4 py-2 transition-colors ${
                  uploadType === t ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {PACK_META[t].label}
              </button>
            ))}
          </div>
          <label
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              uploading
                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-700 hover:bg-emerald-600 text-white'
            }`}
          >
            {uploading ? 'Uploading…' : 'Choose File'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".mcpack,.mcaddon"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>
          <span className="text-xs text-zinc-500">.mcpack or .mcaddon — max 200MB</span>
        </div>
      </div>

      {/* Pack Lists */}
      <div className="space-y-8">
        {(Object.entries(PACK_META) as [PackType, typeof PACK_META[PackType]][]).map(([type, meta]) => (
          <div key={type}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">{meta.label}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
                {packs[type].length} pack{packs[type].length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-zinc-600 text-xs mb-3">{meta.description}</p>

            {packs[type].length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-6 text-center text-zinc-600 text-sm">
                No {meta.label.toLowerCase()} installed yet
              </div>
            ) : (
              <div className="space-y-2">
                {packs[type].length > 1 && (
                  <p className="text-xs text-zinc-600 mb-1">⠿ Drag to reorder — top pack loads first (use for MaterialBinLoader)</p>
                )}
                {packs[type].map((pack, index) => (
                  <div
                    key={pack.uuid}
                    draggable
                    onDragStart={() => handleDragStart(type, index)}
                    onDragEnter={() => handleDragEnter(index)}
                    onDragEnd={() => handleDragEnd(type)}
                    onDragOver={(e) => e.preventDefault()}
                    className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 cursor-grab active:cursor-grabbing active:opacity-60 transition-opacity"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-zinc-600 select-none text-sm">⠿</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-zinc-200 truncate">{pack.name}</p>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                            pack.active
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-700/50 text-zinc-500 border-zinc-600/30'
                          }`}>
                            {pack.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5 font-mono">
                          v{pack.version.join('.')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <button
                        onClick={() => handleToggle(pack.uuid, type)}
                        className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${
                          pack.active
                            ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                            : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                        }`}
                      >
                        {pack.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDelete(pack.uuid, pack.name, type)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
