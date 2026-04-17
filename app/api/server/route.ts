import { NextRequest } from 'next/server'
import { getStatus, getLogs, startServer, stopServer, restartServer, getServerType } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

export async function GET() {
  const logs = getLogs()
  return Response.json({
    status: getStatus(),
    serverType: getServerType(),
    recentLogs: logs.slice(-10),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const action = body?.action

  switch (action) {
    case 'start':
      return Response.json(startServer())
    case 'stop':
      return Response.json(stopServer())
    case 'restart':
      return Response.json(restartServer())
    default:
      return Response.json({ success: false, message: 'Unknown action' }, { status: 400 })
  }
}
