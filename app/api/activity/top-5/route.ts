import { NextRequest, NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

type WindowKey = "today" | "12h" | "7d"

function toLocalIsoNoZone(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function getWindowRange(windowKey: WindowKey): { start: string; end: string } {
  const now = new Date()
  if (windowKey === "12h") {
    return {
      start: toLocalIsoNoZone(new Date(now.getTime() - 12 * 60 * 60 * 1000)),
      end: toLocalIsoNoZone(now),
    }
  }
  if (windowKey === "7d") {
    return {
      start: toLocalIsoNoZone(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
      end: toLocalIsoNoZone(now),
    }
  }
  return {
    start: toLocalIsoNoZone(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)),
    end: toLocalIsoNoZone(now),
  }
}

async function runTop5Query(startIso: string, endIso: string): Promise<unknown> {
  const root = process.cwd()
  const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
  const scriptPath = path.join(root, "model_server", "query_top5.py")

  const usePyLauncher = process.platform === "win32"
  const cmd = usePyLauncher ? "py" : "python3"
  const args = usePyLauncher
    ? ["-3", scriptPath, dbPath, startIso, endIso]
    : [scriptPath, dbPath, startIso, endIso]

  const { stdout } = await execFileAsync(cmd, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

export async function GET(req: NextRequest) {
  try {
    const rawWindow = req.nextUrl.searchParams.get("window")
    const windowKey: WindowKey =
      rawWindow === "12h" || rawWindow === "7d" || rawWindow === "today"
        ? rawWindow
        : "today"

    const { start, end } = getWindowRange(windowKey)
    const data = await runTop5Query(start, end)
    return NextResponse.json(data)
  } catch (error) {
    console.error("top-5 route error:", error)
    return NextResponse.json(
      {
        productiveTop5: [],
        distractingTop5: [],
        lastUpdated: null,
        generatedAt: new Date().toISOString(),
        totalRows: 0,
        stale: true,
        staleMinutes: null,
      },
      { status: 200 }
    )
  }
}
