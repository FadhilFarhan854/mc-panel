import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const runtime = 'nodejs'

// Only allow safe JAR filenames (no path traversal)
const SAFE_JAR_PATTERN = /^[a-zA-Z0-9_\-.]+\.jar$/

function getPluginsDir(): string {
  return path.join(process.env.MINECRAFT_DIR ?? '/opt/minecraft', 'plugins')
}

export async function GET() {
  const dir = getPluginsDir()
  if (!fs.existsSync(dir)) {
    return Response.json({ success: true, plugins: [] })
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jar'))
  const plugins = files.map((name) => {
    const stat = fs.statSync(path.join(dir, name))
    return { name, size: stat.size, modified: stat.mtime.toISOString() }
  })
  return Response.json({ success: true, plugins })
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || typeof file === 'string') {
    return Response.json({ success: false, message: 'No file provided' }, { status: 400 })
  }

  // Limit file size to 100MB
  const MAX_FILE_SIZE = 100 * 1024 * 1024
  if ((file as File).size > MAX_FILE_SIZE) {
    return Response.json(
      { success: false, message: 'File too large (max 100MB)' },
      { status: 413 }
    )
  }

  const filename = (file as File).name
  if (!SAFE_JAR_PATTERN.test(filename)) {
    return Response.json(
      { success: false, message: 'Only .jar files with safe names are allowed' },
      { status: 400 }
    )
  }

  const dir = getPluginsDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const destPath = path.resolve(dir, filename)
  // Prevent path traversal
  if (!destPath.startsWith(path.resolve(dir))) {
    return Response.json({ success: false, message: 'Invalid file path' }, { status: 400 })
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer())
  fs.writeFileSync(destPath, buffer)

  return Response.json({ success: true, message: `${filename} uploaded successfully` })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const name = body?.name

  if (typeof name !== 'string' || !SAFE_JAR_PATTERN.test(name)) {
    return Response.json({ success: false, message: 'Invalid file name' }, { status: 400 })
  }

  const dir = getPluginsDir()
  const filePath = path.resolve(dir, name)

  // Prevent path traversal
  if (!filePath.startsWith(path.resolve(dir))) {
    return Response.json({ success: false, message: 'Invalid file path' }, { status: 400 })
  }

  if (!fs.existsSync(filePath)) {
    return Response.json({ success: false, message: 'File not found' }, { status: 404 })
  }

  fs.unlinkSync(filePath)
  return Response.json({ success: true, message: `${name} deleted` })
}
