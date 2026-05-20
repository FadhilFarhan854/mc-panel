import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import type { NextRequest } from 'next/server'
import { getServerType } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

function isJavaWorld(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, 'level.dat'))
}

function isBedrockWorld(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, 'level.dat'))
}

/** Only allow safe folder name characters — no slashes, dots, or traversal sequences */
function isSafeWorldName(name: string): boolean {
  return /^[a-zA-Z0-9 _\-]+$/.test(name)
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`))
    })
    proc.on('error', reject)
  })
}

/** Find the directory containing level.dat within an extracted archive (up to 1 level deep) */
function findWorldRoot(extractDir: string): string | null {
  if (fs.existsSync(path.join(extractDir, 'level.dat'))) return extractDir
  for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = path.join(extractDir, entry.name)
      if (fs.existsSync(path.join(sub, 'level.dat'))) return sub
    }
  }
  return null
}

export async function GET() {
  const serverDir = getServerDir()

  if (!fs.existsSync(serverDir)) {
    return Response.json({ success: false, message: 'Server directory not found' }, { status: 404 })
  }

  const serverType = getServerType()
  const worlds: string[] = []

  try {
    if (serverType === 'bedrock') {
      // Bedrock stores worlds in <serverDir>/worlds/
      const worldsDir = path.join(serverDir, 'worlds')
      if (fs.existsSync(worldsDir)) {
        for (const entry of fs.readdirSync(worldsDir, { withFileTypes: true })) {
          if (entry.isDirectory() && isBedrockWorld(path.join(worldsDir, entry.name))) {
            worlds.push(entry.name)
          }
        }
      }
    } else {
      // Java stores worlds as folders directly in serverDir containing level.dat
      for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
        if (entry.isDirectory() && isJavaWorld(path.join(serverDir, entry.name))) {
          worlds.push(entry.name)
        }
      }
    }
  } catch (err) {
    return Response.json({ success: false, message: `Failed to read worlds: ${String(err)}` }, { status: 500 })
  }

  return Response.json({ success: true, worlds })
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file')
  const rawName = formData.get('worldName')

  if (!file || typeof file === 'string') {
    return Response.json({ success: false, message: 'No file provided' }, { status: 400 })
  }

  const f = file as File
  const filename = f.name
  const isZip = filename.endsWith('.zip')
  const isTarGz = filename.endsWith('.tar.gz')

  if (!isZip && !isTarGz) {
    return Response.json(
      { success: false, message: 'Only .zip or .tar.gz files are supported' },
      { status: 400 }
    )
  }

  const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB
  if (f.size > MAX_FILE_SIZE) {
    return Response.json(
      { success: false, message: 'File too large (max 500 MB)' },
      { status: 413 }
    )
  }

  const serverDir = getServerDir()
  const serverType = getServerType()
  const worldsDir = serverType === 'bedrock' ? path.join(serverDir, 'worlds') : serverDir

  const tmpId = `mc-world-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpFile = path.join(os.tmpdir(), `${tmpId}${isZip ? '.zip' : '.tar.gz'}`)
  const tmpExtract = path.join(os.tmpdir(), `${tmpId}_extracted`)

  try {
    const buffer = Buffer.from(await f.arrayBuffer())
    fs.mkdirSync(tmpExtract, { recursive: true })
    fs.writeFileSync(tmpFile, buffer)

    if (isZip) {
      await runCommand('unzip', ['-q', '-o', tmpFile, '-d', tmpExtract])
    } else {
      await runCommand('tar', ['-xzf', tmpFile, '-C', tmpExtract])
    }

    const worldRoot = findWorldRoot(tmpExtract)
    if (!worldRoot) {
      return Response.json(
        { success: false, message: 'No valid world found in archive (missing level.dat)' },
        { status: 422 }
      )
    }

    // Determine final world name
    let finalName: string
    if (typeof rawName === 'string' && rawName.trim()) {
      finalName = rawName.trim()
    } else if (worldRoot !== tmpExtract) {
      finalName = path.basename(worldRoot)
    } else {
      finalName = path.basename(filename, isZip ? '.zip' : '.tar.gz')
    }

    if (!isSafeWorldName(finalName)) {
      return Response.json(
        {
          success: false,
          message:
            'World name contains invalid characters. Use letters, numbers, spaces, hyphens, and underscores only.',
        },
        { status: 400 }
      )
    }

    if (!fs.existsSync(worldsDir)) fs.mkdirSync(worldsDir, { recursive: true })

    const destDir = path.resolve(path.join(worldsDir, finalName))
    // Prevent path traversal
    if (!destDir.startsWith(path.resolve(worldsDir) + path.sep)) {
      return Response.json({ success: false, message: 'Invalid world name' }, { status: 400 })
    }

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }
    fs.cpSync(worldRoot, destDir, { recursive: true })

    return Response.json({ success: true, message: `World "${finalName}" imported successfully` })
  } catch (err) {
    return Response.json(
      { success: false, message: `Import failed: ${String(err)}` },
      { status: 500 }
    )
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignored */ }
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }) } catch { /* ignored */ }
  }
}
