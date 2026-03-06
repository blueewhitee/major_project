import { NextRequest, NextResponse } from "next/server"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

function getTodayRange(): { start: string; end: string } {
    const now = new Date()
    return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(),
        end: now.toISOString(),
    }
}

async function runApplyOverride(key: string, classification: string): Promise<unknown> {
    const root = process.cwd()
    const dbPath = path.join(root, "model_server", "database", "focus_tracker.db")
    const scriptPath = path.join(root, "model_server", "apply_override.py")

    const { start, end } = getTodayRange()
    const usePyLauncher = process.platform === "win32"
    const cmd = usePyLauncher ? "py" : "python3"
    const args = usePyLauncher
        ? ["-3", scriptPath, dbPath, key, classification, start, end]
        : [scriptPath, dbPath, key, classification, start, end]

    const { stdout } = await execFileAsync(cmd, args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout)
}

export async function POST(req: NextRequest) {
    try {
        const { key, classification } = await req.json()
        if (!key || (classification !== "PRODUCTIVE" && classification !== "DISTRACTIVE")) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
        }
        const result = await runApplyOverride(key, classification)
        return NextResponse.json(result)
    } catch (error) {
        console.error("override route error:", error)
        return NextResponse.json({ error: "Server error" }, { status: 500 })
    }
}
