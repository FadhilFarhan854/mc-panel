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
