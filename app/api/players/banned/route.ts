import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { sendCommand, getStatus } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

const VALID_USERNAME = /^[a-zA-Z0-9_]{2,16}$/

type BanEntry = {
  uuid: string
  name: string
  created: string
  source: string
  expires: string
  reason: string
}

function getBanListPath(): string {
  return path.join(process.env.MINECRAFT_DIR ?? '/opt/minecraft', 'banned-players.json')
}

function readBanList(): BanEntry[] {
  const p = getBanListPath()
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as BanEntry[]
  } catch {
    return []
  }
}

export async function GET() {
  return Response.json({ success: true, players: readBanList() })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const name = body?.name
  const reason = body?.reason

  if (typeof name !== 'string' || !VALID_USERNAME.test(name)) {
    return Response.json({ success: false, message: 'Invalid player name' }, { status: 400 })
  }

  if (getStatus() !== 'online') {
    return Response.json({ success: false, message: 'Server must be online to ban players' })
  }

  // Sanitize reason: strip newlines, limit length
  const sanitizedReason =
    typeof reason === 'string'
      ? reason.replace(/[\r\n]/g, '').substring(0, 100)
      : 'Banned by an operator.'

  sendCommand(`ban ${name} ${sanitizedReason}`)
  return Response.json({ success: true, message: `Banned ${name}` })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const name = body?.name

  if (typeof name !== 'string' || !VALID_USERNAME.test(name)) {
    return Response.json({ success: false, message: 'Invalid player name' }, { status: 400 })
  }

  if (getStatus() !== 'online') {
    return Response.json({ success: false, message: 'Server must be online to unban players' })
  }

  sendCommand(`pardon ${name}`)
  return Response.json({ success: true, message: `Unbanned ${name}` })
}
