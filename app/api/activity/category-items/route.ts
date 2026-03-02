import { NextRequest, NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

type Scope = "today" | "7d"

function toLocalIsoNoZone(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function getRange(scope: Scope): { start: string; end: string } {
  const now = new Date()
  if (scope === "7d") {
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

async function runCategoryItemsQuery(
  category: string,
  startIso: string,
  endIso: string
): Promise<unknown> {
  const root = process.cwd()
  const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
  const scriptPath = path.join(root, "model_server", "query_category_items.py")

  const usePyLauncher = process.platform === "win32"
  const cmd = usePyLauncher ? "py" : "python3"
  const args = usePyLauncher
    ? ["-3", scriptPath, dbPath, category, startIso, endIso]
    : [scriptPath, dbPath, category, startIso, endIso]

  const { stdout } = await execFileAsync(cmd, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

export async function GET(req: NextRequest) {
  try {
    const category = (req.nextUrl.searchParams.get("category") ?? "").trim().toLowerCase()
    const scopeRaw = req.nextUrl.searchParams.get("scope")
    const scope: Scope = scopeRaw === "7d" ? "7d" : "today"

    if (!category) {
      return NextResponse.json({ category: "", topItems: [], window: null }, { status: 200 })
    }

    const { start, end } = getRange(scope)
    const data = await runCategoryItemsQuery(category, start, end)
    return NextResponse.json(data)
  } catch (error) {
    console.error("category-items route error:", error)
    return NextResponse.json(
      { category: "", topItems: [], window: null },
      { status: 200 }
    )
  }
}
