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

export interface TopActivityItem {
  name: string
  durationSeconds: number
  formattedTime: string
  percentage: number
  eventCount: number
}

export interface Top5Response {
  productiveTop5: TopActivityItem[]
  distractingTop5: TopActivityItem[]
  lastUpdated: string | null
  generatedAt: string
  totalRows: number
  stale: boolean
  staleMinutes: number | null
  window?: { start: string; end: string }
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

/** Build date range for the last N days using local midnight boundaries.
 *  Uses local Date constructor (not UTC) so ActivityWatch receives the correct
 *  timezone-aware ISO string — e.g. "2026-03-03T18:30:00.000Z" for IST midnight.
 */
export function getDateRangeForLastDays(days: number): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
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

// ─── Video Consumption Tracker ────────────────────────────────────────────────

const SHORT_FORM_PATTERNS: { pattern: string; label: string }[] = [
  { pattern: "youtube.com/shorts/", label: "YouTube Shorts" },
  { pattern: "instagram.com/reels/", label: "Instagram Reels" },
  { pattern: "instagram.com/reel/", label: "Instagram Reels" },
  { pattern: "tiktok.com", label: "TikTok" },
  { pattern: "facebook.com/reels/", label: "Facebook Reels" },
  { pattern: "twitter.com/i/status", label: "X / Twitter Clips" },
  { pattern: "x.com/i/status", label: "X / Twitter Clips" },
  { pattern: "snapchat.com/spotlight", label: "Snapchat Spotlight" },
  { pattern: "pinterest.com/pin/", label: "Pinterest Video" },
]

const LONG_FORM_PATTERNS: { pattern: string; label: string }[] = [
  { pattern: "youtube.com/watch", label: "YouTube Videos" },
  { pattern: "youtube.com/feed", label: "YouTube Feed" },
  { pattern: "netflix.com/watch", label: "Netflix" },
  { pattern: "primevideo.com", label: "Prime Video" },
  { pattern: "hotstar.com", label: "Hotstar" },
  { pattern: "twitch.tv", label: "Twitch" },
  { pattern: "vimeo.com", label: "Vimeo" },
  { pattern: "disneyplus.com", label: "Disney+" },
]

export interface ContentEntry {
  label: string
  type: "short" | "long"
  totalSeconds: number
  visitCount: number
  formattedTime: string
}

export interface VideoContentBreakdown {
  shortFormSeconds: number
  longFormSeconds: number
  shortFormPercent: number
  longFormPercent: number
  entries: ContentEntry[]
}

function classifyWebEvents(events: AWBucketEvent[]): ContentEntry[] {
  const map = new Map<string, { type: "short" | "long"; totalSeconds: number; visitCount: number }>()

  for (const event of events) {
    const url = (event.data?.url as string) ?? ""
    if (!url || event.duration <= 0) continue

    const shortMatch = SHORT_FORM_PATTERNS.find((p) => url.includes(p.pattern))
    if (shortMatch) {
      const ex = map.get(shortMatch.label)
      if (ex) { ex.totalSeconds += event.duration; ex.visitCount++ }
      else map.set(shortMatch.label, { type: "short", totalSeconds: event.duration, visitCount: 1 })
      continue
    }

    const longMatch = LONG_FORM_PATTERNS.find((p) => url.includes(p.pattern))
    if (longMatch) {
      const ex = map.get(longMatch.label)
      if (ex) { ex.totalSeconds += event.duration; ex.visitCount++ }
      else map.set(longMatch.label, { type: "long", totalSeconds: event.duration, visitCount: 1 })
    }
  }

  return Array.from(map.entries())
    .map(([label, d]) => ({ label, ...d, formattedTime: formatDuration(d.totalSeconds) }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
}

/**
 * Fetch short-form vs long-form video breakdown for today.
 */
export async function fetchVideoBreakdown(options?: {
  host?: string
  todayOnly?: boolean
  lastDays?: number
  timeperiod?: { start: string; end: string }
}): Promise<VideoContentBreakdown> {
  const { start, end } = options?.todayOnly
    ? getTodayRange()
    : options?.timeperiod ?? getDateRangeForLastDays(options?.lastDays ?? 1)

  const host = options?.host ?? AW_HOST

  let webBucket: string | null = null
  if (host) {
    webBucket = `aw-watcher-web-chrome_${host}`
  } else {
    const ids = await listBucketIds()
    webBucket = ids.find((id) => id.startsWith("aw-watcher-web-chrome")) ?? null
  }

  if (!webBucket) throw new Error("ActivityWatch: no web bucket found")

  const events = await fetchBucketEvents(webBucket, start, end)
  const entries = classifyWebEvents(events)

  const shortFormSeconds = entries.filter((e) => e.type === "short").reduce((s, e) => s + e.totalSeconds, 0)
  const longFormSeconds = entries.filter((e) => e.type === "long").reduce((s, e) => s + e.totalSeconds, 0)
  const totalSeconds = shortFormSeconds + longFormSeconds

  return {
    shortFormSeconds,
    longFormSeconds,
    shortFormPercent: totalSeconds > 0 ? Math.round((shortFormSeconds / totalSeconds) * 100) : 0,
    longFormPercent: totalSeconds > 0 ? Math.round((longFormSeconds / totalSeconds) * 100) : 0,
    entries,
  }
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

export async function fetchTop5Activities(window: "today" | "12h" | "7d" = "today"): Promise<Top5Response> {
  const res = await fetch(`/api/activity/top-5?window=${window}`)
  if (!res.ok) {
    throw new Error(`Top-5 API error: ${res.status}`)
  }
  return res.json()
}

// ─── Entertainment Trigger Classifier ─────────────────────────────────────────

export type EntertainmentTrigger =
  | "short-form"
  | "doom-scroll"
  | "binge-watch"
  | "rabbit-hole"
  | "news-loop"
  | "sports-stream"
  | "gaming-content"
  | "meme-browse"
  | "podcast-audio"

export interface TriggerPattern {
  /** Substring matched against the URL */
  urlPattern?: string
  /** Substring matched against the URL — any of these suffices */
  urlPatterns?: string[]
  /** Substring matched against the page title (case-insensitive) */
  titlePattern?: string
  trigger: EntertainmentTrigger
  label: string
}

/**
 * Ordered from most-specific to least-specific.
 * First match wins, so put narrow patterns before broad ones.
 */
export const TRIGGER_PATTERNS: TriggerPattern[] = [
  // ── Short-form ────────────────────────────────────────────────────────────
  { urlPattern: "youtube.com/shorts/", trigger: "short-form", label: "YouTube Shorts" },
  { urlPattern: "tiktok.com", trigger: "short-form", label: "TikTok" },
  { urlPattern: "instagram.com/reel", trigger: "short-form", label: "Instagram Reels" },
  { urlPattern: "facebook.com/reels", trigger: "short-form", label: "Facebook Reels" },
  { urlPattern: "snapchat.com/spotlight", trigger: "short-form", label: "Snapchat Spotlight" },
  { urlPattern: "pinterest.com/pin/", trigger: "short-form", label: "Pinterest Video" },

  // ── Podcast / Audio ───────────────────────────────────────────────────────
  { urlPattern: "open.spotify.com/episode", trigger: "podcast-audio", label: "Spotify Podcast" },
  { urlPattern: "podcasts.google.com", trigger: "podcast-audio", label: "Google Podcasts" },
  { urlPattern: "pocketcasts.com", trigger: "podcast-audio", label: "Pocket Casts" },
  { urlPattern: "anchor.fm", trigger: "podcast-audio", label: "Anchor Podcast" },
  { urlPattern: "overcast.fm", trigger: "podcast-audio", label: "Overcast" },

  // ── News-loop ─────────────────────────────────────────────────────────────
  { urlPattern: "bbc.com", trigger: "news-loop", label: "BBC News" },
  { urlPattern: "bbc.co.uk", trigger: "news-loop", label: "BBC News" },
  { urlPattern: "cnn.com", trigger: "news-loop", label: "CNN" },
  { urlPattern: "ndtv.com", trigger: "news-loop", label: "NDTV" },
  { urlPattern: "reuters.com", trigger: "news-loop", label: "Reuters" },
  { urlPattern: "bloomberg.com", trigger: "news-loop", label: "Bloomberg" },
  { urlPattern: "nytimes.com", trigger: "news-loop", label: "NY Times" },
  { urlPattern: "theguardian.com", trigger: "news-loop", label: "The Guardian" },
  { urlPattern: "washingtonpost.com", trigger: "news-loop", label: "WashPost" },
  { urlPattern: "hindustantimes.com", trigger: "news-loop", label: "HT" },
  { urlPattern: "timesofindia.com", trigger: "news-loop", label: "TOI" },
  { urlPattern: "thehindu.com", trigger: "news-loop", label: "The Hindu" },
  { urlPattern: "techcrunch.com", trigger: "news-loop", label: "TechCrunch" },
  { urlPattern: "theverge.com", trigger: "news-loop", label: "The Verge" },
  { urlPattern: "arstechnica.com", trigger: "news-loop", label: "Ars Technica" },
  { urlPattern: "reddit.com/r/worldnews", trigger: "news-loop", label: "r/worldnews" },
  { urlPattern: "reddit.com/r/news", trigger: "news-loop", label: "r/news" },
  { urlPattern: "reddit.com/r/technology", trigger: "news-loop", label: "r/technology" },
  { urlPattern: "reddit.com/r/india", trigger: "news-loop", label: "r/india" },
  // Title-based news detection for sites not in the list
  { titlePattern: "breaking news", trigger: "news-loop", label: "Breaking News" },
  { titlePattern: "live updates", trigger: "news-loop", label: "Live News" },

  // ── Sports-stream ─────────────────────────────────────────────────────────
  { urlPattern: "espn.com", trigger: "sports-stream", label: "ESPN" },
  { urlPattern: "cricbuzz.com", trigger: "sports-stream", label: "Cricbuzz" },
  { urlPattern: "livescore.com", trigger: "sports-stream", label: "LiveScore" },
  { urlPattern: "onefootball.com", trigger: "sports-stream", label: "OneFootball" },
  { urlPattern: "sports.ndtv.com", trigger: "sports-stream", label: "NDTV Sports" },
  { urlPattern: "hotstar.com/sports", trigger: "sports-stream", label: "Hotstar Sports" },
  { urlPattern: "reddit.com/r/cricket", trigger: "sports-stream", label: "r/cricket" },
  { urlPattern: "reddit.com/r/soccer", trigger: "sports-stream", label: "r/soccer" },
  { urlPattern: "reddit.com/r/nba", trigger: "sports-stream", label: "r/nba" },
  { urlPattern: "reddit.com/r/formula1", trigger: "sports-stream", label: "r/formula1" },
  // Title-based
  { titlePattern: " vs ", trigger: "sports-stream", label: "Sports Match" },
  { titlePattern: "highlights", trigger: "sports-stream", label: "Sports Highlights" },
  { titlePattern: "live score", trigger: "sports-stream", label: "Live Score" },

  // ── Meme-browse ───────────────────────────────────────────────────────────
  { urlPattern: "9gag.com", trigger: "meme-browse", label: "9GAG" },
  { urlPattern: "ifunny.co", trigger: "meme-browse", label: "iFunny" },
  { urlPattern: "memedroid.com", trigger: "meme-browse", label: "Memedroid" },
  { urlPattern: "reddit.com/r/memes", trigger: "meme-browse", label: "r/memes" },
  { urlPattern: "reddit.com/r/funny", trigger: "meme-browse", label: "r/funny" },
  { urlPattern: "reddit.com/r/dankmemes", trigger: "meme-browse", label: "r/dankmemes" },
  { urlPattern: "reddit.com/r/me_irl", trigger: "meme-browse", label: "r/me_irl" },
  { urlPattern: "reddit.com/r/shitposting", trigger: "meme-browse", label: "r/shitposting" },
  { urlPattern: "reddit.com/r/okbuddyretard", trigger: "meme-browse", label: "r/okbuddy" },

  // ── Gaming-content (video) ────────────────────────────────────────────────
  { urlPattern: "reddit.com/r/gaming", trigger: "gaming-content", label: "r/gaming" },
  { urlPattern: "reddit.com/r/pcgaming", trigger: "gaming-content", label: "r/pcgaming" },
  { urlPattern: "reddit.com/r/gamedeals", trigger: "gaming-content", label: "r/gamedeals" },
  { urlPattern: "store.steampowered.com", trigger: "gaming-content", label: "Steam Store" },
  // YouTube gaming via title
  { urlPattern: "youtube.com/watch", titlePattern: "gameplay", trigger: "gaming-content", label: "Gameplay Video" },
  { urlPattern: "youtube.com/watch", titlePattern: "let's play", trigger: "gaming-content", label: "Let's Play" },
  { urlPattern: "youtube.com/watch", titlePattern: "letsplay", trigger: "gaming-content", label: "Let's Play" },
  { urlPattern: "youtube.com/watch", titlePattern: "walkthrough", trigger: "gaming-content", label: "Walkthrough" },
  { urlPattern: "youtube.com/watch", titlePattern: "speedrun", trigger: "gaming-content", label: "Speedrun" },
  { urlPattern: "youtube.com/watch", titlePattern: "playthrough", trigger: "gaming-content", label: "Playthrough" },

  // ── Binge-watch ───────────────────────────────────────────────────────────
  { urlPattern: "netflix.com", trigger: "binge-watch", label: "Netflix" },
  { urlPattern: "primevideo.com", trigger: "binge-watch", label: "Prime Video" },
  { urlPattern: "hotstar.com", trigger: "binge-watch", label: "Hotstar" },
  { urlPattern: "disneyplus.com", trigger: "binge-watch", label: "Disney+" },
  { urlPattern: "hulu.com", trigger: "binge-watch", label: "Hulu" },
  { urlPattern: "sonyliv.com", trigger: "binge-watch", label: "SonyLIV" },
  { urlPattern: "jiocinema.com", trigger: "binge-watch", label: "JioCinema" },
  { urlPattern: "zee5.com", trigger: "binge-watch", label: "ZEE5" },
  { urlPattern: "voot.com", trigger: "binge-watch", label: "Voot" },
  { urlPattern: "mxplayer.in", trigger: "binge-watch", label: "MX Player" },
  // Title-based episode detection (works for YouTube series too)
  { titlePattern: "season", trigger: "binge-watch", label: "TV Series" },
  { titlePattern: "episode", trigger: "binge-watch", label: "TV Episode" },
  { titlePattern: " s0", trigger: "binge-watch", label: "TV Series" },
  { titlePattern: " e0", trigger: "binge-watch", label: "TV Episode" },

  // ── Rabbit-hole (YouTube catch-all, after all specific YouTube patterns) ──
  { urlPattern: "youtube.com/watch", trigger: "rabbit-hole", label: "YouTube" },
  { urlPattern: "youtube.com/feed", trigger: "rabbit-hole", label: "YouTube Feed" },
  { urlPattern: "vimeo.com", trigger: "rabbit-hole", label: "Vimeo" },

  // ── Doom-scroll (social feeds — broadest, must be last) ───────────────────
  { urlPattern: "twitter.com", trigger: "doom-scroll", label: "X / Twitter" },
  { urlPattern: "x.com", trigger: "doom-scroll", label: "X / Twitter" },
  { urlPattern: "reddit.com", trigger: "doom-scroll", label: "Reddit" },
  { urlPattern: "instagram.com", trigger: "doom-scroll", label: "Instagram" },
  { urlPattern: "facebook.com", trigger: "doom-scroll", label: "Facebook" },
  { urlPattern: "threads.net", trigger: "doom-scroll", label: "Threads" },
  { urlPattern: "tumblr.com", trigger: "doom-scroll", label: "Tumblr" },
  { urlPattern: "linkedin.com/feed", trigger: "doom-scroll", label: "LinkedIn Feed" },
  { urlPattern: "snapchat.com", trigger: "doom-scroll", label: "Snapchat" },
]

export interface TriggerEntry {
  trigger: EntertainmentTrigger
  /** Human-readable label for the specific platform/subreddit */
  label: string
  totalSeconds: number
  visitCount: number
  /** totalSeconds / visitCount */
  avgSessionSeconds: number
  formattedTime: string
}

export interface TriggerBreakdown {
  /** Per-trigger aggregate totals */
  byTrigger: Record<EntertainmentTrigger, number>
  /** Flat list sorted by totalSeconds descending */
  entries: TriggerEntry[]
  /** Grand total seconds across all triggers */
  totalSeconds: number
}

/**
 * Classify a single web event into an EntertainmentTrigger.
 * Returns null if the event doesn't match any entertainment pattern.
 */
export function classifyEntertainmentEvent(
  url: string,
  title: string,
): { trigger: EntertainmentTrigger; label: string } | null {
  const lowerTitle = title.toLowerCase()
  const lowerUrl = url.toLowerCase()

  for (const p of TRIGGER_PATTERNS) {
    const urlOk =
      !p.urlPattern ||
      lowerUrl.includes(p.urlPattern.toLowerCase())

    const titleOk =
      !p.titlePattern ||
      lowerTitle.includes(p.titlePattern.toLowerCase())

    // Both must match when both are specified; single condition is enough otherwise
    if (p.urlPattern && p.titlePattern) {
      if (urlOk && titleOk) return { trigger: p.trigger, label: p.label }
    } else {
      if (urlOk && titleOk) return { trigger: p.trigger, label: p.label }
    }
  }

  return null
}

/**
 * Aggregate raw web events into a TriggerBreakdown.
 * Call this server-side with events already fetched from ActivityWatch.
 */
export function buildTriggerBreakdown(events: AWBucketEvent[]): TriggerBreakdown {
  const byTrigger: Record<EntertainmentTrigger, number> = {
    "short-form": 0,
    "doom-scroll": 0,
    "binge-watch": 0,
    "rabbit-hole": 0,
    "news-loop": 0,
    "sports-stream": 0,
    "gaming-content": 0,
    "meme-browse": 0,
    "podcast-audio": 0,
  }

  // label → { trigger, totalSeconds, visitCount }
  const labelMap = new Map<string, { trigger: EntertainmentTrigger; totalSeconds: number; visitCount: number }>()

  for (const ev of events) {
    if (ev.duration <= 0) continue
    const url = (ev.data?.url as string) ?? ""
    const title = (ev.data?.title as string) ?? ""
    if (!url) continue

    const match = classifyEntertainmentEvent(url, title)
    if (!match) continue

    byTrigger[match.trigger] += ev.duration

    const existing = labelMap.get(match.label)
    if (existing) {
      existing.totalSeconds += ev.duration
      existing.visitCount += 1
    } else {
      labelMap.set(match.label, {
        trigger: match.trigger,
        totalSeconds: ev.duration,
        visitCount: 1,
      })
    }
  }

  const entries: TriggerEntry[] = Array.from(labelMap.entries())
    .map(([label, d]) => ({
      label,
      trigger: d.trigger,
      totalSeconds: d.totalSeconds,
      visitCount: d.visitCount,
      avgSessionSeconds: d.totalSeconds / d.visitCount,
      formattedTime: formatDuration(d.totalSeconds),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)

  const totalSeconds = Object.values(byTrigger).reduce((s, v) => s + v, 0)

  return { byTrigger, entries, totalSeconds }
}

export interface TitleBreakdownItem {
  title: string
  totalSeconds: number
  visitCount: number
  formattedTime: string
}

/**
 * Get unique titles for events matching a given label.
 * Used for the activity feed drill-down (today only).
 */
export function buildTitlesForLabel(
  events: AWBucketEvent[],
  targetLabel: string,
): TitleBreakdownItem[] {
  const titleMap = new Map<string, { totalSeconds: number; visitCount: number }>()

  for (const ev of events) {
    if (ev.duration <= 0) continue
    const url = (ev.data?.url as string) ?? ""
    const title = (ev.data?.title as string) ?? ""
    if (!url) continue

    const match = classifyEntertainmentEvent(url, title)
    if (!match || match.label !== targetLabel) continue

    const displayTitle = title.trim() || "(No title)"
    const existing = titleMap.get(displayTitle)
    if (existing) {
      existing.totalSeconds += ev.duration
      existing.visitCount += 1
    } else {
      titleMap.set(displayTitle, { totalSeconds: ev.duration, visitCount: 1 })
    }
  }

  return Array.from(titleMap.entries())
    .map(([title, d]) => ({
      title,
      totalSeconds: d.totalSeconds,
      visitCount: d.visitCount,
      formattedTime: formatDuration(d.totalSeconds),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
}
