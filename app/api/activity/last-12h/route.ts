import { NextResponse } from "next/server"
import { isDistracting } from "@/lib/activitywatch"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

interface AWEvent {
  timestamp: string
  duration: number
  data: { app?: string; title?: string; url?: string }
}

interface ActivitySegment {
  start: string
  end: string
  category: "productive" | "distracting" | "inactive"
  label: string
}

const BROWSER_APPS = /chrome|firefox|edge|brave|opera|safari|chromium/i

async function fetchBucketEvents(
  bucketId: string,
  start: string,
  end: string
): Promise<AWEvent[]> {
  const params = new URLSearchParams({ start, end, limit: "50000" })
  const res = await fetch(`${AW_BASE}/buckets/${encodeURIComponent(bucketId)}/events?${params}`)
  if (!res.ok) return []
  return res.json()
}

function getLabel(app: string, title: string, url: string): string {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "")
      return host.split(".").slice(-2).join(".")
    } catch {
      //
    }
  }
  if (title) return title.slice(0, 40)
  return app || "Unknown"
}

export async function GET() {
  try {
    const now = new Date()
    const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000)
    const start = tenHoursAgo.toISOString()
    const end = now.toISOString()

    const windowBucket = HOST ? `aw-watcher-window_${HOST}` : null
    const webBucket = HOST ? `aw-watcher-web-chrome_${HOST}` : null
    const afkBucket = HOST ? `aw-watcher-afk_${HOST}` : null

    if (!windowBucket || !webBucket) {
      return NextResponse.json([])
    }

    const [windowEvents, webEvents, afkEvents] = await Promise.all([
    fetchBucketEvents(windowBucket, start, end),
    fetchBucketEvents(webBucket, start, end),
    afkBucket ? fetchBucketEvents(afkBucket, start, end) : Promise.resolve([]),
  ])

  const segments: ActivitySegment[] = []

  for (const ev of webEvents) {
    const app = (ev.data?.app as string) ?? ""
    const title = (ev.data?.title as string) ?? ""
    const url = (ev.data?.url as string) ?? ""
    const startDate = new Date(ev.timestamp)
    const endDate = new Date(startDate.getTime() + ev.duration * 1000)
    const distracting = isDistracting(app, title, url)
    segments.push({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      category: distracting ? "distracting" : "productive",
      label: getLabel(app, title, url),
    })
  }

  for (const ev of windowEvents) {
    const app = (ev.data?.app as string) ?? ""
    const title = (ev.data?.title as string) ?? ""
    if (BROWSER_APPS.test(app)) continue
    const startDate = new Date(ev.timestamp)
    const endDate = new Date(startDate.getTime() + ev.duration * 1000)
    const distracting = isDistracting(app, title, "")
    segments.push({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      category: distracting ? "distracting" : "productive",
      label: app || "Unknown",
    })
  }

  for (const ev of afkEvents) {
    const status = (ev.data as { status?: string })?.status
    if (status !== "afk") continue
    const startDate = new Date(ev.timestamp)
    const endDate = new Date(startDate.getTime() + ev.duration * 1000)
    segments.push({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      category: "inactive",
      label: "AFK",
    })
  }

    segments.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    return NextResponse.json(segments)
  } catch (err) {
    console.error("Activity timeline fetch error:", err)
    return NextResponse.json([])
  }
}
