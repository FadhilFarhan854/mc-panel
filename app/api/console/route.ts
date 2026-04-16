import { NextRequest } from 'next/server'
import { getLogs, addLogListener, sendCommand } from '@/lib/minecraft-server'

export const runtime = 'nodejs'

export async function GET() {
  const encoder = new TextEncoder()
  const initialLogs = getLogs()
  let removeListener: (() => void) | null = null

  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send all buffered logs first
      for (const line of initialLogs) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
      }

      // Subscribe to new log lines
      removeListener = addLogListener((line) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
        } catch {
          removeListener?.()
          removeListener = null
        }
      })

      // Heartbeat every 25 seconds to keep connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
        }
      }, 25000)
    },
    cancel() {
      removeListener?.()
      removeListener = null
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const command = body?.command

  if (typeof command !== 'string') {
    return Response.json({ success: false, message: 'Invalid command' }, { status: 400 })
  }

  return Response.json(sendCommand(command))
}
