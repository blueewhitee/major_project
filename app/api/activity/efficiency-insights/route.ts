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

function getTodayRange(): { start: string; end: string } {
  const now = new Date()
  return {
    start: toLocalIsoNoZone(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)),
    end: toLocalIsoNoZone(now),
  }
}

export async function GET() {
  try {
    const root = process.cwd()
    const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
    const scriptPath = path.join(root, "model_server", "query_efficiency.py")
    const { start, end } = getTodayRange()

    const usePyLauncher = process.platform === "win32"
    const cmd = usePyLauncher ? "py" : "python3"
    const args = usePyLauncher
      ? ["-3", scriptPath, dbPath, start, end]
      : [scriptPath, dbPath, start, end]

    const { stdout } = await execFileAsync(cmd, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })

    return NextResponse.json(JSON.parse(stdout))
  } catch (error) {
    console.error("efficiency-insights route error:", error)
    return NextResponse.json({
      mostProductive: "N/A",
      mostDistracting: "N/A",
      focusPeakPercent: 0,
      focusPeakHour: "N/A",
      sampleSize: 0,
    })
  }
}
