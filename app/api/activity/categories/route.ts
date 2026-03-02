import { NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

function toLocalIsoNoZone(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

async function runCategoriesQuery(
  startIso: string,
  endIso: string
): Promise<unknown> {
  const root = process.cwd()
  const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
  const scriptPath = path.join(root, "model_server", "query_categories.py")

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

export async function GET() {
  try {
    const now = new Date()
    const todayStart = toLocalIsoNoZone(
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    )
    const nowIso = toLocalIsoNoZone(now)

    const data = await runCategoriesQuery(todayStart, nowIso)
    return NextResponse.json(data)
  } catch (error) {
    console.error("categories route error:", error)
    return NextResponse.json(
      {
        todayCategories: [],
        allTimeCategories: [],
        stale: true,
        staleMinutes: null,
        lastUpdated: null,
        generatedAt: new Date().toISOString(),
      },
      { status: 200 }
    )
  }
}
