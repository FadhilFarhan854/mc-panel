import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

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
        const data = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (data?.header?.uuid && Array.isArray(data.header.version)) {
          return data.header as ManifestHeader
        }
      } catch { /* skip invalid */ }
    }
    if (entry.isDirectory()) {
      const found = findManifest(full)
      if (found) return found
    }
  }
  return null
}

// ── Extraction helpers ───────────────────────────────────────────────────

/**
 * Extract a single .mcpack ZIP into packsDir/<folderName>.
 * Returns the absolute path of the extracted folder.
 */
function extractMcpack(zipPath: string, packsDir: string, folderName: string): string {
  const extractDir = path.join(packsDir, folderName)
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`)
  return extractDir
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
    // Extract the .mcaddon wrapper to a temp dir, then find inner .mcpack files
    const tmpDir = path.join(packsDir, `__tmp_${Date.now()}`)
    try {
      fs.mkdirSync(tmpDir, { recursive: true })
      execSync(`unzip -o -q "${uploadedPath}" -d "${tmpDir}"`)

      // Find all .mcpack files inside (may be nested)
      const mcpacks = findMcpackFiles(tmpDir)

      if (mcpacks.length === 0) {
        // No inner .mcpack — treat the whole extracted content as one pack
        const manifest = findManifest(tmpDir)
        if (manifest) {
          const folderName = manifest.name
            ? sanitizeFolderName(manifest.name)
            : baseName
          const dest = path.join(packsDir, folderName)
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
          fs.renameSync(tmpDir, dest)
          results.push({ folder: folderName, manifest })
          return results
        }
        // tmpDir cleanup happens in finally
      } else {
        for (const mcpackPath of mcpacks) {
          const innerBase = path.basename(mcpackPath, '.mcpack')
          const innerDir = path.join(packsDir, `__inner_${Date.now()}_${innerBase}`)
          try {
            fs.mkdirSync(innerDir, { recursive: true })
            execSync(`unzip -o -q "${mcpackPath}" -d "${innerDir}"`)
            const manifest = findManifest(innerDir)
            if (manifest) {
              const folderName = manifest.name
                ? sanitizeFolderName(manifest.name)
                : innerBase
              const dest = path.join(packsDir, folderName)
              if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
              fs.renameSync(innerDir, dest)
              results.push({ folder: folderName, manifest })
            } else {
              if (fs.existsSync(innerDir)) fs.rmSync(innerDir, { recursive: true, force: true })
            }
          } catch {
            if (fs.existsSync(innerDir)) fs.rmSync(innerDir, { recursive: true, force: true })
          }
        }
      }
    } finally {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  } else {
    // Plain .mcpack — extract directly
    const tmpDir = path.join(packsDir, `__tmp_${Date.now()}`)
    try {
      fs.mkdirSync(tmpDir, { recursive: true })
      execSync(`unzip -o -q "${uploadedPath}" -d "${tmpDir}"`)
      const manifest = findManifest(tmpDir)
      if (manifest) {
        const folderName = manifest.name
          ? sanitizeFolderName(manifest.name)
          : baseName
        const dest = path.join(packsDir, folderName)
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
        fs.renameSync(tmpDir, dest)
        results.push({ folder: folderName, manifest })
      } else {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    } catch {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  return results
}

function findMcpackFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.mcpack')) {
      results.push(full)
    } else if (entry.isDirectory()) {
      results.push(...findMcpackFiles(full))
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
    return Response.json(
      { success: false, message: 'Invalid pack: no manifest.json with uuid/version found inside the file' },
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

/** Path to the world_*_packs.json file that activates packs for the world */
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

interface ManifestHeader {
  uuid: string
  version: number[]
  name?: string
}

/** Recursively find manifest.json inside a directory */
function findManifest(dir: string): ManifestHeader | null {
  if (!fs.existsSync(dir)) return null
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === 'manifest.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (data?.header?.uuid && Array.isArray(data.header.version)) {
          return data.header as ManifestHeader
        }
      } catch { /* skip invalid */ }
    }
    if (entry.isDirectory()) {
      const found = findManifest(full)
      if (found) return found
    }
  }
  return null
}

/** Extract a .mcpack/.mcaddon (ZIP) into the packs directory and return extracted folder name */
function extractPack(zipPath: string, packsDir: string): string {
  const baseName = path.basename(zipPath).replace(/\.(mcpack|mcaddon)$/i, '')
  const extractDir = path.join(packsDir, baseName)

  // Remove existing folder if present (re-upload / update)
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
  fs.mkdirSync(extractDir, { recursive: true })

  // Use system unzip
  execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`)

  return baseName
}

interface InstalledPack {
  name: string
  uuid: string
  version: number[]
  active: boolean
}

/** List installed (extracted) packs of a given type */
function listInstalledPacks(type: PackType): InstalledPack[] {
  const dir = getPacksDir(type)
  if (!fs.existsSync(dir)) return []

  const worldPacks = readWorldPacks(type)
  const activeIds = new Set(worldPacks.map((p) => p.pack_id))

  const packs: InstalledPack[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = findManifest(path.join(dir, entry.name))
    if (!manifest) continue
    packs.push({
      name: manifest.name ?? entry.name,
      uuid: manifest.uuid,
      version: manifest.version,
      active: activeIds.has(manifest.uuid),
    })
  }
  return packs
}

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET() {
  const result: Record<PackType, InstalledPack[]> = {
    resource: listInstalledPacks('resource'),
    behavior: listInstalledPacks('behavior'),
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
  const destPath = path.resolve(dir, filename)
  if (!destPath.startsWith(path.resolve(dir))) {
    return Response.json({ success: false, message: 'Invalid file path' }, { status: 400 })
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer())
  fs.writeFileSync(destPath, buffer)

  // Extract the pack
  let folderName: string
  try {
    folderName = extractPack(destPath, dir)
  } catch (err) {
    // Clean up the zip on failure
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
    return Response.json(
      { success: false, message: `Failed to extract pack: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 500 }
    )
  }

  // Remove the .mcpack/.mcaddon file after extraction
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)

  // Read manifest to get UUID + version
  const extractedDir = path.join(dir, folderName)
  const manifest = findManifest(extractedDir)
  if (!manifest) {
    fs.rmSync(extractedDir, { recursive: true, force: true })
    return Response.json(
      { success: false, message: 'Invalid pack: no manifest.json with uuid/version found' },
      { status: 400 }
    )
  }

  // Register pack in world_*_packs.json
  const worldPacks = readWorldPacks(type)
  const existing = worldPacks.findIndex((p) => p.pack_id === manifest.uuid)
  if (existing >= 0) {
    worldPacks[existing].version = manifest.version
  } else {
    worldPacks.push({ pack_id: manifest.uuid, version: manifest.version })
  }
  writeWorldPacks(type, worldPacks)

  const displayName = manifest.name ?? folderName
  return Response.json({
    success: true,
    message: `${displayName} uploaded and activated. Restart the server for changes to take effect.`,
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
  const dir = getPacksDir(type)

  // Find the folder with this UUID
  let foundDir: string | null = null
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = findManifest(path.join(dir, entry.name))
      if (manifest && manifest.uuid === uuid) {
        foundDir = path.join(dir, entry.name)
        break
      }
    }
  }

  if (!foundDir) {
    return Response.json({ success: false, message: 'Pack not found' }, { status: 404 })
  }

  // Remove from world_*_packs.json
  const worldPacks = readWorldPacks(type).filter((p) => p.pack_id !== uuid)
  writeWorldPacks(type, worldPacks)

  // Remove extracted folder
  fs.rmSync(foundDir, { recursive: true, force: true })

  return Response.json({ success: true, message: 'Pack removed. Restart the server for changes to take effect.' })
}
