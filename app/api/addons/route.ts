import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

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

export async function GET() {
  const result: Record<PackType, { name: string; size: number; modified: string }[]> = {
    resource: [],
    behavior: [],
  }

  for (const type of VALID_PACK_TYPES) {
    const dir = getPacksDir(type)
    if (!fs.existsSync(dir)) continue
    result[type] = fs
      .readdirSync(dir)
      .filter((f) => /\.(mcpack|mcaddon)$/.test(f))
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name))
        return { name, size: stat.size, modified: stat.mtime.toISOString() }
      })
  }

  return Response.json({ success: true, packs: result })
}

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

  const dir = getPacksDir(packType as PackType)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const destPath = path.resolve(dir, filename)
  if (!destPath.startsWith(path.resolve(dir))) {
    return Response.json({ success: false, message: 'Invalid file path' }, { status: 400 })
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer())
  fs.writeFileSync(destPath, buffer)

  return Response.json({ success: true, message: `${filename} uploaded successfully` })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const { name, type: packType } = body

  if (typeof name !== 'string' || !SAFE_PACK_PATTERN.test(name)) {
    return Response.json({ success: false, message: 'Invalid file name' }, { status: 400 })
  }

  if (!VALID_PACK_TYPES.includes(packType as PackType)) {
    return Response.json({ success: false, message: 'Invalid pack type' }, { status: 400 })
  }

  const dir = getPacksDir(packType as PackType)
  const filePath = path.resolve(dir, name)

  if (!filePath.startsWith(path.resolve(dir))) {
    return Response.json({ success: false, message: 'Invalid file path' }, { status: 400 })
  }

  if (!fs.existsSync(filePath)) {
    return Response.json({ success: false, message: 'File not found' }, { status: 404 })
  }

  fs.unlinkSync(filePath)
  return Response.json({ success: true, message: `${name} deleted` })
}
