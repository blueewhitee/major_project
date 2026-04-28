import { NextRequest, NextResponse } from "next/server"
import {
  buildTitlesForLabel,
  getEntertainmentFeedWebRange,
  type AWBucketEvent,
} from "@/lib/activitywatch"
import { readCache, type CacheKey } from "@/lib/activity-cache"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

const WEB_EVENTS_CACHE: Record<"today" | "week" | "month", CacheKey> = {
  today: "web-events-today",
  week: "web-events-week",
  month: "web-events-month",
}

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

/**
 * GET /api/activity/entertainment-triggers/[label]/titles
 *
 * Query: range = today | week | month (same windows as entertainment-triggers).
 * Uses cached web events when available; otherwise fetches ActivityWatch.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  try {
    if (!HOST) return NextResponse.json({ titles: [] })

    const { label } = await params
    const decodedLabel = decodeURIComponent(label)

    const rawRange = request.nextUrl.searchParams.get("range") ?? "today"
    const range =
      rawRange === "week" || rawRange === "month" ? rawRange : "today"

    const cacheKey = WEB_EVENTS_CACHE[range]
    const cached = await readCache<AWBucketEvent[]>(cacheKey)
    let events: AWBucketEvent[]

    if (cached?.data) {
      events = cached.data as AWBucketEvent[]
    } else {
      const { start, end } = getEntertainmentFeedWebRange(range)
      const webBucket = `aw-watcher-web-chrome_${HOST}`
      events = await fetchEvents(webBucket, start, end)
    }

    const titles = buildTitlesForLabel(events, decodedLabel)
    return NextResponse.json({ titles })
  } catch (err) {
    console.error("entertainment-triggers titles error:", err)
    return NextResponse.json({ titles: [] })
  }
}
