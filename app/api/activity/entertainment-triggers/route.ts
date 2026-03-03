import { NextRequest, NextResponse } from "next/server"
import type { TriggerBreakdown } from "@/lib/activitywatch"
import { readCache, isCacheFresh } from "@/lib/activity-cache"
import { refreshInBackground } from "@/lib/activity-cache-refresh"

const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

const EMPTY: TriggerBreakdown = {
  byTrigger: {
    "short-form": 0,
    "doom-scroll": 0,
    "binge-watch": 0,
    "rabbit-hole": 0,
    "news-loop": 0,
    "sports-stream": 0,
    "gaming-content": 0,
    "meme-browse": 0,
    "podcast-audio": 0,
  },
  entries: [],
  totalSeconds: 0,
}

const CACHE_KEYS = {
  today: "entertainment-today" as const,
  week: "entertainment-week" as const,
  month: "entertainment-month" as const,
}

/**
 * GET /api/activity/entertainment-triggers
 *
 * Query params:
 *   range = "today" (default) | "week" | "month"
 *
 * Returns TriggerBreakdown from cache. Triggers background refresh if stale.
 */
export async function GET(request: NextRequest) {
  try {
    if (!HOST) return NextResponse.json(EMPTY)

    const range = (request.nextUrl.searchParams.get("range") ?? "today") as
      | "today"
      | "week"
      | "month"

    const cacheKey = CACHE_KEYS[range]
    const entry = await readCache<TriggerBreakdown>(cacheKey)

    if (entry) {
      if (!isCacheFresh(entry.updatedAt)) {
        refreshInBackground()
      }
      return NextResponse.json(entry.data)
    }

    refreshInBackground()
    return NextResponse.json(EMPTY)
  } catch (err) {
    console.error("entertainment-triggers error:", err)
    return NextResponse.json(EMPTY)
  }
}
