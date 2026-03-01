/**
 * ActivityWatch API client for fetching distracting-activity data.
 * Used by the "Distracting Activities" section of the dashboard.
 * Supports both Query API and Bucket Events API (latter for per-app breakdown).
 */

// --- Types ---
export interface AWEvent {
  timestamp: string
  duration: number
  data: Record<string, unknown>
}

/** Event shape from bucket events API (data may have app, title, url). */
export interface AWBucketEvent {
  timestamp: string
  duration: number
  data: {
    app?: string
    title?: string
    url?: string
    [k: string]: unknown
  }
}

export interface CategoryRule {
  appRegex: RegExp | null
  titleRegex: RegExp | null
}

export interface AWQueryResponse {
  games: AWEvent[]
  video: AWEvent[]
  social: AWEvent[]
  music: AWEvent[]
  media_all: AWEvent[]
}

export type DistractingCategory = keyof Omit<AWQueryResponse, "media_all">

export interface DistractingActivityItem {
  key: DistractingCategory
  name: string
  durationSeconds: number
  formattedTime: string
  percentage: number
  eventCount: number
}

// --- Configuration ---
// All requests go through the Next.js API proxy (/api/aw/...) to avoid CORS.
// The proxy server-side forwards to the real ActivityWatch instance.
export const AW_BASE_URL = "/api/aw"

/** Host identifier for bucket IDs (e.g. "ASHU" → aw-watcher-window_ASHU). Set via NEXT_PUBLIC_ACTIVITYWATCH_HOST. */
export const AW_HOST = typeof process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST === "string"
  ? process.env.NEXT_PUBLIC_ACTIVITYWATCH_HOST.trim()
  : undefined

function getBucketIdsForHost(host: string): { window: string; web: string } {
  return {
    window: `aw-watcher-window_${host}`,
    web: `aw-watcher-web-chrome_${host}`,
  }
}

const QUERY = [
  "window_events = query_bucket(find_bucket('aw-watcher-window_'))",
  "web_events    = query_bucket(find_bucket('aw-watcher-web-chrome'))",
  "afk_events    = query_bucket(find_bucket('aw-watcher-afk_'))",
  "not_afk       = filter_keyvals(afk_events, 'status', ['not-afk'])",
  "active_window = filter_period_intersect(window_events, not_afk)",
  "active_web    = filter_period_intersect(web_events,    not_afk)",
  "games = filter_keyvals_regex(active_window, 'app',   'Minecraft|RimWorld')",
  "video_app = filter_keyvals_regex(active_window, 'app',   'YouTube|Plex|VLC')",
  "video_web = filter_keyvals_regex(active_web,    'title', 'YouTube|Plex|VLC')",
  "social_app = filter_keyvals_regex(active_window, 'app',   'reddit|Facebook|Twitter|Instagram|devRant')",
  "social_web = filter_keyvals_regex(active_web,    'title', 'reddit|Facebook|Twitter|Instagram|devRant')",
  "music = filter_keyvals_regex(active_window, 'app', 'Spotify|Music|foobar|iTunes|Deezer|Tidal')",
  "media = union(games, video_app)",
  "media = union(media, video_web)",
  "media = union(media, social_app)",
  "media = union(media, social_web)",
  "media = union(media, music)",
  "RETURN = {'games': games, 'video': union(video_app, video_web), 'social': union(social_app, social_web), 'music': music, 'media_all': media}",
].join(";")

const CATEGORY_LABELS: Record<DistractingCategory, string> = {
  games: "Games",
  video: "Video",
  social: "Social",
  music: "Music",
}

/** Category rules for bucket-based breakdown (per-app / per-domain). */
export const MEDIA_CATEGORIES: Record<string, CategoryRule> = {
  Games: {
    appRegex: /Minecraft|RimWorld/i,
    titleRegex: null,
  },
  Video: {
    appRegex: /YouTube|Plex|VLC/i,
    titleRegex: /YouTube|Plex|VLC/i,
  },
  "Social Media": {
    appRegex: /reddit|Facebook|Twitter|Instagram|devRant/i,
    titleRegex: /reddit|Facebook|Twitter|Instagram|devRant/i,
  },
  Music: {
    appRegex: /Spotify|Music|foobar|iTunes|Deezer|Tidal/i,
    titleRegex: /Spotify|Music|Deezer|Tidal/i,
  },
}

/** Check if app/title/url matches any distracting category. */
export function isDistracting(app: string, title: string, url: string): boolean {
  for (const rules of Object.values(MEDIA_CATEGORIES)) {
    if (rules.appRegex?.test(app)) return true
    if (rules.titleRegex && (rules.titleRegex.test(title) || rules.titleRegex.test(url))) return true
  }
  return false
}

/** Flattened item for UI: one row per app/domain with duration. */
export interface MediaBreakdownItem {
  name: string
  category: string
  durationSeconds: number
  formattedTime: string
  percentage: number
}

// --- Helpers ---
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 && h === 0) parts.push(`${s}s`)
  return parts.join(" ") || "0m"
}

function getDomain(url: string): string {
  try {
    const host = new URL(url).hostname
    return host.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function calculateTotalDuration(events: AWEvent[]): number {
  return events.reduce((acc, curr) => acc + curr.duration, 0)
}

/** Build date range for the last N days in YYYY-MM-DD format. */
export function getDateRangeForLastDays(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

/** Build range for today: 00:00 local time to current time (ISO strings for API). */
export function getTodayRange(): { start: string; end: string } {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  return {
    start: startOfDay.toISOString(),
    end: now.toISOString(),
  }
}

/** List bucket IDs from ActivityWatch (GET /api/0/buckets/). */
async function listBucketIds(): Promise<string[]> {
  const res = await fetch(`${AW_BASE_URL}/buckets/`)
  if (!res.ok) throw new Error(`ActivityWatch buckets error: ${res.status}`)
  const data = (await res.json()) as Record<string, unknown>
  return Object.keys(data)
}

/** Fetch events for a bucket in a date range. start/end: YYYY-MM-DD or full ISO string. */
async function fetchBucketEvents(
  bucketId: string,
  start: string,
  end: string,
  limit = 100_000
): Promise<AWBucketEvent[]> {
  const startParam = start.includes("T") ? start : `${start}T00:00:00Z`
  const endParam = end.includes("T") ? end : `${end}T23:59:59Z`
  const params = new URLSearchParams({
    start: startParam,
    end: endParam,
    limit: String(limit),
  })
  const res = await fetch(`${AW_BASE_URL}/buckets/${encodeURIComponent(bucketId)}/events?${params}`)
  if (!res.ok) throw new Error(`ActivityWatch events error: ${res.status} for ${bucketId}`)
  return res.json()
}

/**
 * Fetch distracting-activity breakdown using the bucket events API.
 * Returns per-app/per-domain times (e.g. YouTube, Instagram) for the "Distracting Activities" UI.
 * Uses the configured host (env or options) so data is for a specific machine.
 */
export async function fetchMediaBreakdown(options?: {
  /** Host for bucket IDs (e.g. "ASHU"). Overrides NEXT_PUBLIC_ACTIVITYWATCH_HOST. */
  host?: string
  /** If true, fetch only from 00:00 today to now. */
  todayOnly?: boolean
  lastDays?: number
  timeperiod?: { start: string; end: string }
}): Promise<MediaBreakdownItem[]> {
  const { start, end } = options?.todayOnly
    ? getTodayRange()
    : options?.timeperiod ?? getDateRangeForLastDays(options?.lastDays ?? 30)

  const host = options?.host ?? AW_HOST
  let windowBucket: string | null = null
  let webBucket: string | null = null

  if (host) {
    const ids = getBucketIdsForHost(host)
    windowBucket = ids.window
    webBucket = ids.web
  } else {
    const bucketIds = await listBucketIds()
    windowBucket = bucketIds.find((id) => id.startsWith("aw-watcher-window_")) ?? null
    webBucket = bucketIds.find((id) => id.startsWith("aw-watcher-web-chrome")) ?? null
  }

  if (!windowBucket && !webBucket) {
    throw new Error(
      host
        ? `ActivityWatch: no buckets for host "${host}". Check NEXT_PUBLIC_ACTIVITYWATCH_HOST or the host option.`
        : "ActivityWatch: no window or web buckets found"
    )
  }

  const [windowEvents, webEvents] = await Promise.all([
    windowBucket ? fetchBucketEvents(windowBucket, start, end) : Promise.resolve([]),
    webBucket ? fetchBucketEvents(webBucket, start, end) : Promise.resolve([]),
  ])

  const finalBreakdown: Record<string, Record<string, number>> = {}

  for (const [category, rules] of Object.entries(MEDIA_CATEGORIES)) {
    const platformTime: Record<string, number> = {}

    if (rules.appRegex) {
      for (const ev of windowEvents) {
        const app = (ev.data?.app as string) ?? ""
        if (rules.appRegex.test(app)) {
          platformTime[app] = (platformTime[app] ?? 0) + ev.duration
        }
      }
    }

    if (rules.titleRegex) {
      for (const ev of webEvents) {
        const title = (ev.data?.title as string) ?? ""
        const url = (ev.data?.url as string) ?? ""
        if (rules.titleRegex.test(title) || rules.titleRegex.test(url)) {
          const domain = url ? getDomain(url) : title || "unknown"
          platformTime[domain] = (platformTime[domain] ?? 0) + ev.duration
        }
      }
    }

    if (Object.keys(platformTime).length > 0) {
      finalBreakdown[category] = platformTime
    }
  }

  const flat: MediaBreakdownItem[] = []
  for (const [category, platforms] of Object.entries(finalBreakdown)) {
    for (const [name, secs] of Object.entries(platforms)) {
      flat.push({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        category,
        durationSeconds: secs,
        formattedTime: formatDuration(secs),
        percentage: 0,
      })
    }
  }

  const maxSecs = Math.max(1, ...flat.map((i) => i.durationSeconds))
  flat.forEach((i) => {
    i.percentage = Math.round((i.durationSeconds / maxSecs) * 100)
  })

  return flat.sort((a, b) => b.durationSeconds - a.durationSeconds)
}

/**
 * Fetch distracting-activity summary from ActivityWatch and return items
 * suitable for the "Distracting Activities" UI (name, duration, percentage).
 */
export async function fetchDistractingActivities(options?: {
  /** Number of days to look back. Default 30. */
  lastDays?: number
  /** Override date range (e.g. for testing). */
  timeperiod?: { start: string; end: string }
}): Promise<DistractingActivityItem[]> {
  const { start, end } =
    options?.timeperiod ?? getDateRangeForLastDays(options?.lastDays ?? 30)
  const timeperiods = [`${start}/${end}`]

  const response = await fetch(`${AW_BASE_URL}/query/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeperiods,
      query: [QUERY],
    }),
  })

  if (!response.ok) {
    throw new Error(`ActivityWatch error: ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as AWQueryResponse[]
  const data = json[0]
  if (!data) return []

  const categories: DistractingCategory[] = ["games", "video", "social", "music"]
  const items: DistractingActivityItem[] = categories.map((key) => {
    const events = data[key] ?? []
    const durationSeconds = calculateTotalDuration(events)
    return {
      key,
      name: CATEGORY_LABELS[key],
      durationSeconds,
      formattedTime: formatDuration(durationSeconds),
      percentage: 0, // set below
      eventCount: events.length,
    }
  })

  const maxDuration = Math.max(1, ...items.map((i) => i.durationSeconds))
  items.forEach((item) => {
    item.percentage = Math.round((item.durationSeconds / maxDuration) * 100)
  })

  return items.sort((a, b) => b.durationSeconds - a.durationSeconds)
}
