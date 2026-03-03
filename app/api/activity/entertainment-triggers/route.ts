import { NextRequest, NextResponse } from "next/server"
import {
  buildTriggerBreakdown,
  type TriggerBreakdown,
  type AWBucketEvent,
} from "@/lib/activitywatch"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST    = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

async function fetchEvents(
  bucketId: string,
  start: string,
  end: string,
): Promise<AWBucketEvent[]> {
  const params = new URLSearchParams({ start, end, limit: "100000" })
  const res = await fetch(
    `${AW_BASE}/buckets/${encodeURIComponent(bucketId)}/events?${params}`,
  )
  if (!res.ok) return []
  return res.json()
}

const EMPTY: TriggerBreakdown = {
  byTrigger: {
    "short-form":     0,
    "doom-scroll":    0,
    "binge-watch":    0,
    "rabbit-hole":    0,
    "live-stream":    0,
    "news-loop":      0,
    "sports-stream":  0,
    "gaming-content": 0,
    "meme-browse":    0,
    "podcast-audio":  0,
  },
  entries: [],
  totalSeconds: 0,
}

/**
 * GET /api/activity/entertainment-triggers
 *
 * Query params:
 *   range = "today" (default) | "week" | "month"
 *
 * Returns TriggerBreakdown:
 *   byTrigger   – seconds per trigger type
 *   entries     – per-platform rows sorted by totalSeconds desc
 *   totalSeconds – grand total
 */
export async function GET(request: NextRequest) {
  try {
    if (!HOST) return NextResponse.json(EMPTY)

    const range = (request.nextUrl.searchParams.get("range") ?? "today") as
      | "today"
      | "week"
      | "month"

    const now   = new Date()
    let start: string

    if (range === "today") {
      const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      start = sod.toISOString()
    } else {
      const days = range === "week" ? 7 : 30
      start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
    }

    const end = now.toISOString()
    const webBucket = `aw-watcher-web-chrome_${HOST}`

    const events = await fetchEvents(webBucket, start, end)
    const breakdown = buildTriggerBreakdown(events)

    return NextResponse.json(breakdown)
  } catch (err) {
    console.error("entertainment-triggers error:", err)
    return NextResponse.json(EMPTY)
  }
}
