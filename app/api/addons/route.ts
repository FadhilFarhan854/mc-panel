import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import AdmZip from 'adm-zip'

export const runtime = 'nodejs'

type PackType = 'resource' | 'behavior'

const VALID_PACK_TYPES: PackType[] = ['resource', 'behavior']
const SAFE_PACK_PATTERN = /^[a-zA-Z0-9_\-. ]+\.(mcpack|mcaddon)$/
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

function getPacksDir(type: PackType): string {
  const folder = type === 'resource' ? 'resource_packs' : 'behavior_packs'
  return path.join(getServerDir(), folder)
}

/** Read level-name from server.properties to locate the world folder */
function getWorldDir(): string {
  const propsPath = path.join(getServerDir(), 'server.properties')
  let levelName = 'Bedrock level'
  if (fs.existsSync(propsPath)) {
    const content = fs.readFileSync(propsPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('level-name=')) {
        levelName = trimmed.substring('level-name='.length).trim() || levelName
        break
      }
    }
  }
  return path.join(getServerDir(), 'worlds', levelName)
}

function getWorldPacksJsonPath(type: PackType): string {
  const filename = type === 'resource' ? 'world_resource_packs.json' : 'world_behavior_packs.json'
  return path.join(getWorldDir(), filename)
}

type PackEntry = { pack_id: string; version: number[] }

function readWorldPacks(type: PackType): PackEntry[] {
  const p = getWorldPacksJsonPath(type)
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PackEntry[]
  } catch {
    return []
  }
}

function writeWorldPacks(type: PackType, entries: PackEntry[]): void {
  const p = getWorldPacksJsonPath(type)
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf8')
}

// ── Panel-managed pack registry ──────────────────────────────────────────
// Tracks which packs were uploaded via the panel so we don't list vanilla packs.
interface PanelPackRecord {
  uuid: string
  type: PackType
  name: string
  version: number[]
  folder: string // subfolder name inside resource_packs / behavior_packs
}

function getPanelPacksPath(): string {
  return path.join(getServerDir(), 'panel-packs.json')
}

function readPanelPacks(): PanelPackRecord[] {
  const p = getPanelPacksPath()
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PanelPackRecord[]
  } catch {
    return []
  }
}

function writePanelPacks(records: PanelPackRecord[]): void {
  fs.writeFileSync(getPanelPacksPath(), JSON.stringify(records, null, 2), 'utf8')
}

// ── Manifest helpers ─────────────────────────────────────────────────────
interface ManifestHeader {
  uuid: string
  version: number[]
  name?: string
}

function findManifest(dir: string): ManifestHeader | null {
  if (!fs.existsSync(dir)) return null
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === 'manifest.json') {
      try {
        // Strip BOM if present
        let raw = fs.readFileSync(full, 'utf8')
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
        const data = JSON.parse(raw)
        const h = data?.header
        if (!h?.uuid) continue
        // Accept version as array OR string (normalize to array)
        let version: number[]
        if (Array.isArray(h.version)) {
          version = h.version
        } else if (typeof h.version === 'string') {
          version = h.version.split('.').map(Number)
        } else {
          version = [1, 0, 0]
        }
        return { uuid: String(h.uuid), version, name: h.name }
      } catch { /* skip invalid */ }
    }
    if (entry.isDirectory()) {
      const found = findManifest(full)
      if (found) return found
    }
  }
  return null
}

/** List all files (relative paths) inside a directory recursively, for diagnostics */
function listFilesRecursive(dir: string, base = ''): string[] {
  if (!fs.existsSync(dir)) return []
  const result: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) result.push(...listFilesRecursive(path.join(dir, entry.name), rel))
    else result.push(rel)
  }
  return result
}

// ── Extraction helpers ───────────────────────────────────────────────────

/** Extract a ZIP buffer into a directory using adm-zip. */
function extractZipToDir(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(destDir, true)
}

/** Collect all .mcpack entries from an already-opened AdmZip. */
function collectMcpackBuffers(zip: AdmZip): { name: string; buffer: Buffer }[] {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.mcpack'))
    .map((e) => ({ name: path.basename(e.entryName), buffer: e.getData() }))
}

/**
 * Handle one uploaded file (.mcpack or .mcaddon).
 * Returns an array of extracted { folder, manifest } objects.
 * .mcaddon may contain multiple .mcpack files; each is extracted separately.
 */
function extractUpload(
  uploadedPath: string,
  originalName: string,
  packsDir: string
): { folder: string; manifest: ManifestHeader }[] {
  const baseName = originalName.replace(/\.(mcpack|mcaddon)$/i, '')
  const results: { folder: string; manifest: ManifestHeader }[] = []

  if (originalName.toLowerCase().endsWith('.mcaddon')) {
    const outerZip = new AdmZip(uploadedPath)
    const innerPacks = collectMcpackBuffers(outerZip)

    if (innerPacks.length === 0) {
      // No inner .mcpack — treat the whole extracted content as one pack
      const tmpDir = path.join(packsDir, `__tmp_${Date.now()}`)
      try {
        fs.mkdirSync(tmpDir, { recursive: true })
        outerZip.extractAllTo(tmpDir, true)
        const manifest = findManifest(tmpDir)
        if (manifest) {
          const folderName = manifest.name ? sanitizeFolderName(manifest.name) : baseName
          const dest = path.join(packsDir, folderName)
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
          fs.renameSync(tmpDir, dest)
          results.push({ folder: folderName, manifest })
          return results
        }
      } finally {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    } else {
      for (const { name, buffer } of innerPacks) {
        const innerBase = name.replace(/\.mcpack$/i, '')
        const innerDir = path.join(packsDir, `__inner_${Date.now()}_${innerBase}`)
        try {
          fs.mkdirSync(innerDir, { recursive: true })
          const innerZip = new AdmZip(buffer)
          innerZip.extractAllTo(innerDir, true)
          const manifest = findManifest(innerDir)
          if (manifest) {
            const folderName = manifest.name ? sanitizeFolderName(manifest.name) : innerBase
            const dest = path.join(packsDir, folderName)
            if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
            fs.renameSync(innerDir, dest)
            results.push({ folder: folderName, manifest })
          } else {
            fs.rmSync(innerDir, { recursive: true, force: true })
          }
        } catch {
          if (fs.existsSync(innerDir)) fs.rmSync(innerDir, { recursive: true, force: true })
        }
      }
    }
  } else {
    // Plain .mcpack — extract directly
    const tmpDir = path.join(packsDir, `__tmp_${Date.now()}`)
    try {
      fs.mkdirSync(tmpDir, { recursive: true })
      extractZipToDir(uploadedPath, tmpDir)
      const manifest = findManifest(tmpDir)
      if (manifest) {
        const folderName = manifest.name ? sanitizeFolderName(manifest.name) : baseName
        const dest = path.join(packsDir, folderName)
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
        fs.renameSync(tmpDir, dest)
        results.push({ folder: folderName, manifest })
      } else {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    } catch (err) {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
      throw err
    }
  }

  return results
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim() || 'pack'
}

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET() {
  const panelPacks = readPanelPacks()
  const result: Record<PackType, object[]> = { resource: [], behavior: [] }

  for (const type of VALID_PACK_TYPES) {
    const worldPacks = readWorldPacks(type)
    const activeIds = new Set(worldPacks.map((p) => p.pack_id))

    result[type] = panelPacks
      .filter((p) => p.type === type)
      .map((p) => ({
        name: p.name,
        uuid: p.uuid,
        version: p.version,
        active: activeIds.has(p.uuid),
      }))
  }

  return Response.json({ success: true, packs: result })
}

// ── POST (upload) ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file')
  const packType = formData.get('type') as string

  if (!file || typeof file === 'string') {
    return Response.json({ success: false, message: 'No file provided' }, { status: 400 })
  }

  if (!VALID_PACK_TYPES.includes(packType as PackType)) {
    return Response.json({ success: false, message: 'Invalid pack type. Must be "resource" or "behavior"' }, { status: 400 })
  }

  if ((file as File).size > MAX_FILE_SIZE) {
    return Response.json({ success: false, message: 'File too large (max 200MB)' }, { status: 413 })
  }

  const filename = (file as File).name
  if (!SAFE_PACK_PATTERN.test(filename)) {
    return Response.json(
      { success: false, message: 'Only .mcpack or .mcaddon files with safe names are allowed' },
      { status: 400 }
    )
  }

  const type = packType as PackType
  const dir = getPacksDir(type)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Save uploaded file temporarily
  const uploadPath = path.resolve(dir, `__upload_${Date.now()}_${filename}`)
  const buffer = Buffer.from(await (file as File).arrayBuffer())
  fs.writeFileSync(uploadPath, buffer)

  let extracted: { folder: string; manifest: ManifestHeader }[] = []
  try {
    extracted = extractUpload(uploadPath, filename, dir)
  } catch (err) {
    return Response.json(
      { success: false, message: `Failed to extract pack: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 500 }
    )
  } finally {
    if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath)
  }

  if (extracted.length === 0) {
    // Diagnostic: try to list what was extracted from the temp dir for debugging
    const diagDir = path.join(dir, '__diag_last')
    let diagFiles: string[] = []
    try {
      fs.mkdirSync(diagDir, { recursive: true })
      const zip = new AdmZip(Buffer.from(await (file as File).arrayBuffer()))
      zip.extractAllTo(diagDir, true)
      diagFiles = listFilesRecursive(diagDir)
    } catch { /* ignore */ } finally {
      if (fs.existsSync(diagDir)) fs.rmSync(diagDir, { recursive: true, force: true })
    }
    const detail = diagFiles.length > 0
      ? ` Files found: ${diagFiles.slice(0, 20).join(', ')}`
      : ' No files could be extracted.'
    return Response.json(
      { success: false, message: `Invalid pack: no manifest.json with uuid/version found inside the file.${detail}` },
      { status: 400 }
    )
  }

  // Register each extracted pack
  const panelPacks = readPanelPacks()
  const worldPacks = readWorldPacks(type)
  const names: string[] = []

  for (const { folder, manifest } of extracted) {
    // Update panel registry
    const panelIdx = panelPacks.findIndex((p) => p.uuid === manifest.uuid)
    const record: PanelPackRecord = {
      uuid: manifest.uuid,
      type,
      name: manifest.name ?? folder,
      version: manifest.version,
      folder,
    }
    if (panelIdx >= 0) panelPacks[panelIdx] = record
    else panelPacks.push(record)

    // Update world activation
    const worldIdx = worldPacks.findIndex((p) => p.pack_id === manifest.uuid)
    if (worldIdx >= 0) worldPacks[worldIdx].version = manifest.version
    else worldPacks.push({ pack_id: manifest.uuid, version: manifest.version })

    names.push(manifest.name ?? folder)
  }

  writePanelPacks(panelPacks)
  writeWorldPacks(type, worldPacks)

  return Response.json({
    success: true,
    message: `${names.join(', ')} uploaded and activated. Restart the server for changes to take effect.`,
  })
}

// ── DELETE ───────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const { uuid, type: packType } = body

  if (typeof uuid !== 'string' || !/^[a-f0-9\-]{36}$/i.test(uuid)) {
    return Response.json({ success: false, message: 'Invalid pack UUID' }, { status: 400 })
  }

  if (!VALID_PACK_TYPES.includes(packType as PackType)) {
    return Response.json({ success: false, message: 'Invalid pack type' }, { status: 400 })
  }

  const type = packType as PackType
  const panelPacks = readPanelPacks()
  const record = panelPacks.find((p) => p.uuid === uuid && p.type === type)

  if (!record) {
    return Response.json({ success: false, message: 'Pack not found' }, { status: 404 })
  }

  // Remove extracted folder
  const dir = getPacksDir(type)
  const folderPath = path.resolve(dir, record.folder)
  if (folderPath.startsWith(path.resolve(dir)) && fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true })
  }

  // Remove from world activation
  writeWorldPacks(type, readWorldPacks(type).filter((p) => p.pack_id !== uuid))

  // Remove from panel registry
  writePanelPacks(panelPacks.filter((p) => p.uuid !== uuid))

  return Response.json({ success: true, message: `${record.name} removed. Restart the server for changes to take effect.` })
}

// ── PUT (toggle activation) ──────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { uuid, type: packType } = body

  if (typeof uuid !== 'string' || !/^[a-f0-9\-]{36}$/i.test(uuid)) {
    return Response.json({ success: false, message: 'Invalid pack UUID' }, { status: 400 })
  }
  if (!VALID_PACK_TYPES.includes(packType as PackType)) {
    return Response.json({ success: false, message: 'Invalid pack type' }, { status: 400 })
  }

  const type = packType as PackType
  const panelPacks = readPanelPacks()
  const record = panelPacks.find((p) => p.uuid === uuid && p.type === type)
  if (!record) {
    return Response.json({ success: false, message: 'Pack not found' }, { status: 404 })
  }

  const worldPacks = readWorldPacks(type)
  const isActive = worldPacks.some((p) => p.pack_id === uuid)

  if (isActive) {
    writeWorldPacks(type, worldPacks.filter((p) => p.pack_id !== uuid))
    return Response.json({ success: true, active: false, message: `${record.name} deactivated. Restart the server for changes to take effect.` })
  } else {
    writeWorldPacks(type, [...worldPacks, { pack_id: uuid, version: record.version }])
    return Response.json({ success: true, active: true, message: `${record.name} activated. Restart the server for changes to take effect.` })
  }
}

// ── PATCH (reorder) ──────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type: packType, uuids } = body

  if (!VALID_PACK_TYPES.includes(packType as PackType)) {
    return Response.json({ success: false, message: 'Invalid pack type' }, { status: 400 })
  }
  if (!Array.isArray(uuids) || !uuids.every((u) => typeof u === 'string')) {
    return Response.json({ success: false, message: 'Invalid uuids array' }, { status: 400 })
  }

  const type = packType as PackType
  const panelPacks = readPanelPacks()

  // Reorder panel-packs: move packs of this type into the given order, keep other types unchanged
  const others = panelPacks.filter((p) => p.type !== type)
  const reordered = (uuids as string[])
    .map((uuid) => panelPacks.find((p) => p.uuid === uuid && p.type === type))
    .filter((p): p is PanelPackRecord => p !== undefined)
  writePanelPacks([...others, ...reordered])

  // Reorder world packs JSON in the same order
  const worldPacks = readWorldPacks(type)
  const worldMap = new Map(worldPacks.map((p) => [p.pack_id, p]))
  const reorderedWorld = (uuids as string[])
    .map((uuid) => worldMap.get(uuid))
    .filter((p): p is PackEntry => p !== undefined)
  writeWorldPacks(type, reorderedWorld)

  return Response.json({ success: true })
}
