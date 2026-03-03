import { NextResponse } from "next/server"
import { readCache, isCacheFresh } from "@/lib/activity-cache"
import { refreshInBackground } from "@/lib/activity-cache-refresh"

const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

interface ActivitySegment {
  start: string
  end: string
  category: "productive" | "distracting" | "inactive"
  label: string
}

/**
 * Returns last-12h segments from cache. Triggers background refresh if stale.
 */
export async function GET() {
  try {
    if (!HOST) return NextResponse.json([])

    const entry = await readCache<ActivitySegment[]>("last-12h")

    if (entry) {
      if (!isCacheFresh(entry.updatedAt)) {
        refreshInBackground()
      }
      return NextResponse.json(entry.data)
    }

    refreshInBackground()
    return NextResponse.json([])
  } catch (err) {
    console.error("Activity timeline fetch error:", err)
    return NextResponse.json([])
  }
}
