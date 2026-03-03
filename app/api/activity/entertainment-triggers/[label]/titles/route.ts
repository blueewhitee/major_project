import { NextRequest, NextResponse } from "next/server"
import { buildTitlesForLabel, type AWBucketEvent } from "@/lib/activitywatch"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

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
 * Returns unique page titles for the given label, today only.
 * Sorted by totalSeconds descending.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  try {
    if (!HOST) return NextResponse.json({ titles: [] })

    const { label } = await params
    const decodedLabel = decodeURIComponent(label)

    const now = new Date()
    const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const start = sod.toISOString()
    const end = now.toISOString()

    const webBucket = `aw-watcher-web-chrome_${HOST}`
    const events = await fetchEvents(webBucket, start, end)
    const titles = buildTitlesForLabel(events, decodedLabel)

    return NextResponse.json({ titles })
  } catch (err) {
    console.error("entertainment-triggers titles error:", err)
    return NextResponse.json({ titles: [] })
  }
}
