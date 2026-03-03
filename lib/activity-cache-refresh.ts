/**
 * Background refresh of activity cache.
 * Fetches from ActivityWatch, runs classification, writes to cache.
 * Call refreshInBackground() — it does not block.
 */

import {
  buildTriggerBreakdown,
  isDistracting,
  type AWBucketEvent,
} from "@/lib/activitywatch"
import {
  ensureCacheDir,
  writeCache,
  readCache,
  isCacheFresh,
  shouldTriggerRefresh,
} from "./activity-cache"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"
const HOST = process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST ?? ""

const BROWSER_APPS = /chrome|firefox|edge|brave|opera|safari|chromium/i

interface AWEvent {
  timestamp: string
  duration: number
  data: { app?: string; title?: string; url?: string; status?: string }
}

interface ActivitySegment {
  start: string
  end: string
  category: "productive" | "distracting" | "inactive"
  label: string
}

async function fetchEvents(
  bucketId: string,
  start: string,
  end: string,
): Promise<AWEvent[]> {
  const params = new URLSearchParams({ start, end, limit: "100000" })
  const res = await fetch(
    `${AW_BASE}/buckets/${encodeURIComponent(bucketId)}/events?${params}`,
  )
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

async function doRefresh(): Promise<void> {
  if (!HOST) return
  try {
    const now = new Date()
    const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startToday = sod.toISOString()
    const end = now.toISOString()
    const startWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const startMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString()

    const windowBucket = `aw-watcher-window_${HOST}`
    const webBucket = `aw-watcher-web-chrome_${HOST}`
    const afkBucket = `aw-watcher-afk_${HOST}`

    const [webToday, webWeek, webMonth, windowToday, webLast12h, windowLast12h, afkToday, afkLast12h] =
      await Promise.all([
        fetchEvents(webBucket, startToday, end),
        fetchEvents(webBucket, startWeek, end),
        fetchEvents(webBucket, startMonth, end),
        fetchEvents(windowBucket, startToday, end),
        fetchEvents(webBucket, tenHoursAgo, end),
        fetchEvents(windowBucket, tenHoursAgo, end),
        fetchEvents(afkBucket, startToday, end),
        fetchEvents(afkBucket, tenHoursAgo, end),
      ])

    const webTodayAsBucket = webToday as unknown as AWBucketEvent[]

    const breakdownToday = buildTriggerBreakdown(webTodayAsBucket)
    const breakdownWeek = buildTriggerBreakdown(webWeek as unknown as AWBucketEvent[])
    const breakdownMonth = buildTriggerBreakdown(webMonth as unknown as AWBucketEvent[])

    await Promise.all([
      writeCache("entertainment-today", breakdownToday),
      writeCache("entertainment-week", breakdownWeek),
      writeCache("entertainment-month", breakdownMonth),
      writeCache("web-events-today", webToday),
    ])

    let distractingSeconds = 0
    let productiveSeconds = 0
    for (const ev of webToday) {
      if (ev.duration <= 0) continue
      const url = (ev.data?.url as string) ?? ""
      const title = (ev.data?.title as string) ?? ""
      if (isDistracting("", title, url)) {
        distractingSeconds += ev.duration
      } else {
        productiveSeconds += ev.duration
      }
    }
    for (const ev of windowToday) {
      if (ev.duration <= 0) continue
      const app = (ev.data?.app as string) ?? ""
      const title = (ev.data?.title as string) ?? ""
      if (BROWSER_APPS.test(app)) continue
      if (isDistracting(app, title, "")) {
        distractingSeconds += ev.duration
      } else {
        productiveSeconds += ev.duration
      }
    }
    const activeSeconds = afkToday
      .filter((e) => (e.data as { status?: string })?.status === "not-afk")
      .reduce((s, e) => s + e.duration, 0)
    const total = productiveSeconds + distractingSeconds
    const focusPercent = total > 0 ? Math.round((productiveSeconds / total) * 100) : 0

    await writeCache("focus-today", {
      focusPercent,
      productiveSeconds,
      distractingSeconds,
      activeSeconds,
    })

    const segments: ActivitySegment[] = []
    for (const ev of webLast12h) {
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
    for (const ev of windowLast12h) {
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
    for (const ev of afkLast12h) {
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

    await writeCache("last-12h", segments)
  } catch (err) {
    console.error("activity-cache refresh error:", err)
  }
}

/**
 * Starts a background refresh if cache is stale and not recently refreshed.
 * Does not block.
 */
export function refreshInBackground(): void {
  if (!HOST) return
  if (!shouldTriggerRefresh()) return

  void doRefresh()
}
