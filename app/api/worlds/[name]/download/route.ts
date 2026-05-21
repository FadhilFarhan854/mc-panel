import { spawn } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import AdmZip from 'adm-zip'
import type { NextRequest } from 'next/server'
import { getServerType } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

type DownloadFormat = 'tar.gz' | 'zip' | 'mcworld' | 'mcpack'

function getServerDir(): string {
  return process.env.MINECRAFT_DIR ?? '/opt/minecraft'
}

/** Only allow safe folder name characters — no slashes, dots, or traversal sequences */
function isSafeWorldName(name: string): boolean {
  return /^[a-zA-Z0-9 _\-]+$/.test(name)
}

function parseFormat(raw: string | null): DownloadFormat {
  if (raw === 'zip' || raw === 'mcworld' || raw === 'mcpack') return raw
  return 'tar.gz'
}

function buildZipBuffer(worldsDir: string, name: string): Buffer {
  const zip = new AdmZip()
  zip.addLocalFolder(path.join(worldsDir, name), name)
  return zip.toBuffer()
}

export async function GET(req: NextRequest, ctx: RouteContext<'/api/worlds/[name]/download'>) {
  const { name } = await ctx.params

  if (!isSafeWorldName(name)) {
    return Response.json({ success: false, message: 'Invalid world name' }, { status: 400 })
  }

  const format = parseFormat(req.nextUrl.searchParams.get('format'))
  const serverDir = getServerDir()
  const serverType = getServerType()

  const worldsDir =
    serverType === 'bedrock' ? path.join(serverDir, 'worlds') : serverDir

  // Prevent path traversal: resolved world path must be a direct child of worldsDir
  const resolvedWorldsDir = path.resolve(worldsDir)
  const resolvedWorld = path.resolve(path.join(worldsDir, name))

  if (!resolvedWorld.startsWith(resolvedWorldsDir + path.sep)) {
    return Response.json({ success: false, message: 'Invalid world path' }, { status: 400 })
  }

  if (!fs.existsSync(resolvedWorld)) {
    return Response.json({ success: false, message: 'World not found' }, { status: 404 })
  }

  // ── ZIP / MCWORLD / MCPACK ────────────────────────────────────────────────
  if (format === 'zip' || format === 'mcworld' || format === 'mcpack') {
    const ext = format === 'zip' ? 'zip' : format  // mcworld | mcpack | zip
    const filename = `${name}.${ext}`
    let buffer: Buffer
    try {
      buffer = buildZipBuffer(worldsDir, name)
    } catch (err) {
      console.error('[worlds/download] zip error:', err)
      return Response.json({ success: false, message: 'Failed to create archive' }, { status: 500 })
    }
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── TAR.GZ (default) ─────────────────────────────────────────────────────
  const filename = `${name}.tar.gz`

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const proc = spawn('tar', ['-czf', '-', name], { cwd: worldsDir })

      proc.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        // tar writes progress info to stderr — ignore unless fatal
        console.error('[worlds/download] tar stderr:', chunk.toString())
      })

      proc.on('close', (code) => {
        if (code === 0) {
          controller.close()
        } else {
          controller.error(new Error(`tar process exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        controller.error(err)
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
