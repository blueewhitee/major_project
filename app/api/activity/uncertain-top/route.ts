import { NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)

function getTodayRange(): { start: string; end: string } {
    const now = new Date()
    return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(),
        end: now.toISOString(),
    }
}

async function runUncertainQuery(startIso: string, endIso: string): Promise<unknown> {
    const root = process.cwd()
    const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
    const scriptPath = path.join(root, "model_server", "query_uncertain.py")

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
        const { start, end } = getTodayRange()
        const data = await runUncertainQuery(start, end)
        return NextResponse.json(data)
    } catch (error) {
        console.error("uncertain-top route error:", error)
        return NextResponse.json({ uncertainItems: [] }, { status: 200 })
    }
}
