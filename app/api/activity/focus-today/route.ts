import { NextResponse } from "next/server"
import { isDistracting } from "@/lib/activitywatch"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

interface AWEvent {
  timestamp: string
  duration: number
  data: { app?: string; title?: string; url?: string; status?: string }
}

export interface FocusTodayResult {
  focusPercent: number
  productiveSeconds: number
  distractingSeconds: number
  activeSeconds: number
}

const BROWSER_APPS = /chrome|firefox|edge|brave|opera|safari|chromium/i

async function fetchEvents(bucketId: string, start: string, end: string): Promise<AWEvent[]> {
  const params = new URLSearchParams({ start, end, limit: "100000" })
  const res = await fetch(`${AW_BASE}/buckets/${encodeURIComponent(bucketId)}/events?${params}`)
  if (!res.ok) return []
  return res.json()
}

export async function GET() {
  try {
    if (!HOST) return NextResponse.json({ focusPercent: 0, productiveSeconds: 0, distractingSeconds: 0, activeSeconds: 0 })

    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const start = startOfDay.toISOString()
    const end = now.toISOString()

    const windowBucket = `aw-watcher-window_${HOST}`
    const webBucket    = `aw-watcher-web-chrome_${HOST}`
    const afkBucket    = `aw-watcher-afk_${HOST}`

    const [windowEvents, webEvents, afkEvents] = await Promise.all([
      fetchEvents(windowBucket, start, end),
      fetchEvents(webBucket, start, end),
      fetchEvents(afkBucket, start, end),
    ])

    // Total active (non-AFK) seconds
    const activeSeconds = afkEvents
      .filter((e) => (e.data as { status?: string })?.status === "not-afk")
      .reduce((s, e) => s + e.duration, 0)

    let distractingSeconds = 0
    let productiveSeconds = 0

    // Web events — classify by URL
    for (const ev of webEvents) {
      if (ev.duration <= 0) continue
      const url   = (ev.data?.url   as string) ?? ""
      const title = (ev.data?.title as string) ?? ""
      if (isDistracting("", title, url)) {
        distractingSeconds += ev.duration
      } else {
        productiveSeconds += ev.duration
      }
    }

    // Window events — skip browser apps (already counted via web bucket)
    for (const ev of windowEvents) {
      if (ev.duration <= 0) continue
      const app   = (ev.data?.app   as string) ?? ""
      const title = (ev.data?.title as string) ?? ""
      if (BROWSER_APPS.test(app)) continue
      if (isDistracting(app, title, "")) {
        distractingSeconds += ev.duration
      } else {
        productiveSeconds += ev.duration
      }
    }

    // Focus score: productive / (productive + distracting), floored at 0
    const total = productiveSeconds + distractingSeconds
    const focusPercent = total > 0
      ? Math.round((productiveSeconds / total) * 100)
      : 0

    return NextResponse.json({ focusPercent, productiveSeconds, distractingSeconds, activeSeconds } satisfies FocusTodayResult)
  } catch (err) {
    console.error("focus-today error:", err)
    return NextResponse.json({ focusPercent: 0, productiveSeconds: 0, distractingSeconds: 0, activeSeconds: 0 })
  }
}
