import { NextResponse } from "next/server"
import { readCache, isCacheFresh } from "@/lib/activity-cache"
import { refreshInBackground } from "@/lib/activity-cache-refresh"

const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

export interface FocusTodayResult {
  focusPercent: number
  productiveSeconds: number
  distractingSeconds: number
  activeSeconds: number
}

const EMPTY: FocusTodayResult = {
  focusPercent: 0,
  productiveSeconds: 0,
  distractingSeconds: 0,
  activeSeconds: 0,
}

/**
 * Returns focus-today from cache. Triggers background refresh if stale.
 */
export async function GET() {
  try {
    if (!HOST) return NextResponse.json(EMPTY)

    const entry = await readCache<FocusTodayResult>("focus-today")

    if (entry) {
      if (!isCacheFresh(entry.updatedAt)) {
        refreshInBackground()
      }
      return NextResponse.json(entry.data)
    }

    refreshInBackground()
    return NextResponse.json(EMPTY)
  } catch (err) {
    console.error("focus-today error:", err)
    return NextResponse.json(EMPTY)
  }
}
