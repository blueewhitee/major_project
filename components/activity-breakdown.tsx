"use client"

import { useState, useEffect } from "react"
import {
  fetchTop5Activities,
  fetchVideoBreakdown,
  type Top5Response,
  type VideoContentBreakdown,
} from "@/lib/activitywatch"
import { UncertainActivityReview } from "./uncertain-activity-review"

const TOP_DISTRACTING_COUNT = 5
type Top5Window = "today" | "7d"

/** Map app/site name to domain for favicon URL (Google favicon service). */
function getFaviconDomain(name: string): string {
  const n = name.toLowerCase()
  if (n.includes("youtube")) return "youtube.com"
  if (n.includes("instagram")) return "instagram.com"
  if (n.includes("twitter") || n.includes("x.com")) return "x.com"
  if (n.includes("reddit")) return "reddit.com"
  if (n.includes("tiktok")) return "tiktok.com"
  if (n.includes("spotify")) return "spotify.com"
  if (n.includes("deezer")) return "deezer.com"
  if (n.includes("tidal")) return "tidal.com"
  if (n.includes("facebook")) return "facebook.com"
  if (n.includes("plex")) return "plex.tv"
  if (n.includes("twitch")) return "twitch.tv"
  if (n.includes("netflix")) return "netflix.com"
  if (n.includes("discord")) return "discord.com"
  if (n.includes("linkedin")) return "linkedin.com"
  if (n.includes("github")) return "github.com"
  // Already a domain (has a dot)
  if (n.includes(".")) return n
  return `${n}.com`
}

/** Favicon URL from the web (Google's favicon service, no API key). */
function getFaviconUrl(name: string, size = 32): string {
  const domain = getFaviconDomain(name)
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
}

function SiteIcon({ name, className }: { name: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = getFaviconUrl(name, 64)

  if (failed) {
    return (
      <span
        className={`flex items-center justify-center rounded bg-gray-200 text-xs font-medium text-gray-500 ${className ?? "w-5 h-5"}`}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      className={`rounded object-contain ${className ?? "w-5 h-5"}`}
      onError={() => setFailed(true)}
    />
  )
}

function VSCodeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="4" fill="#007ACC" />
      <path d="M17 3l-7 7-4-3-3 2 5 4-5 4 3 2 4-3 7 7 4-2V5z" fill="white" fillOpacity="0.9" />
    </svg>
  )
}

function GoogleDocsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="4" fill="#4285F4" />
      <rect x="6" y="4" width="12" height="16" rx="1" fill="white" />
      <line x1="8.5" y1="9" x2="15.5" y2="9" stroke="#4285F4" strokeWidth="1" />
      <line x1="8.5" y1="11.5" x2="15.5" y2="11.5" stroke="#4285F4" strokeWidth="1" />
      <line x1="8.5" y1="14" x2="13" y2="14" stroke="#4285F4" strokeWidth="1" />
    </svg>
  )
}

function FigmaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="4" fill="#1E1E1E" />
      <circle cx="10" cy="8" r="2.5" fill="#F24E1E" />
      <circle cx="14" cy="8" r="2.5" fill="#FF7262" />
      <circle cx="10" cy="12" r="2.5" fill="#A259FF" />
      <circle cx="14" cy="12" r="2.5" fill="#1ABCFE" />
      <circle cx="10" cy="16" r="2.5" fill="#0ACF83" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <defs>
        <linearGradient id="ig-grad2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#feda75" />
          <stop offset="25%" stopColor="#fa7e1e" />
          <stop offset="50%" stopColor="#d62976" />
          <stop offset="75%" stopColor="#962fbf" />
          <stop offset="100%" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#ig-grad2)" />
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
    </svg>
  )
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="6" fill="#1DA1F2" />
      <path
        d="M18.244 8.213c.013.178.013.356.013.534 0 5.434-4.138 11.699-11.699 11.699v-.003a11.65 11.65 0 01-2.558-.3 8.245 8.245 0 006.077-1.699 4.113 4.113 0 01-3.838-2.853c.614.117 1.247.093 1.848-.069a4.108 4.108 0 01-3.295-4.027v-.052c.564.313 1.193.487 1.838.507a4.112 4.112 0 01-1.272-5.482 11.66 11.66 0 008.462 4.291 4.112 4.112 0 016.997-3.748 8.236 8.236 0 002.607-.997 4.12 4.12 0 01-1.806 2.27 8.213 8.213 0 002.362-.647 8.355 8.355 0 01-2.052 2.127z"
        fill="white"
        transform="scale(0.65) translate(5, 3)"
      />
    </svg>
  )
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="6" fill="#FF4500" />
      <circle cx="12" cy="13" r="5" fill="white" />
      <circle cx="10" cy="12.5" r="1" fill="#FF4500" />
      <circle cx="14" cy="12.5" r="1" fill="#FF4500" />
      <path d="M10 15c.5.5 1.5.8 2 .8s1.5-.3 2-.8" stroke="#FF4500" strokeWidth="0.7" fill="none" strokeLinecap="round" />
      <circle cx="16.5" cy="7" r="1.5" fill="white" />
      <line x1="13" y1="6" x2="16" y2="7" stroke="white" strokeWidth="0.8" />
      <ellipse cx="17" cy="10.5" rx="2" ry="1.8" fill="white" />
      <ellipse cx="7" cy="10.5" rx="2" ry="1.8" fill="white" />
    </svg>
  )
}

function NotionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="4" fill="#fff" stroke="#333" strokeWidth="1" />
      <path d="M7 5h6l4 2v12H7z" fill="none" stroke="#333" strokeWidth="1.2" />
      <line x1="9" y1="10" x2="15" y2="10" stroke="#333" strokeWidth="0.8" />
      <line x1="9" y1="12.5" x2="15" y2="12.5" stroke="#333" strokeWidth="0.8" />
      <line x1="9" y1="15" x2="13" y2="15" stroke="#333" strokeWidth="0.8" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="4" fill="#1E1E1E" />
      <path d="M7 8l4 4-4 4" stroke="#22c55e" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="16" x2="17" y2="16" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="6" fill="#FF0000" />
      <path d="M10 8.5v7l6-3.5z" fill="white" />
    </svg>
  )
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect width="24" height="24" rx="6" fill="#010101" />
      <path d="M15.5 5.5c0 1.5 1 2.8 2.5 3v2c-1.3 0-2.3-.5-3-1.2v5.2a4.5 4.5 0 11-4.5-4.5v2a2.5 2.5 0 102.5 2.5V5.5h2.5z" fill="white" />
    </svg>
  )
}

function formatLastUpdated(lastUpdated: string | null): string {
  if (!lastUpdated) return "No recent events"
  const ts = new Date(lastUpdated)
  const diffSecs = Math.floor((Date.now() - ts.getTime()) / 1000)
  if (diffSecs < 60) return "Updated <1m ago"
  const mins = Math.floor(diffSecs / 60)
  if (mins < 60) return `Updated ${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `Updated ${hours}h ago`
}

export function ActivityBreakdown() {
  const [top5Window, setTop5Window] = useState<Top5Window>("today")
  const [top5, setTop5] = useState<Top5Response | null>(null)
  const [top5Loading, setTop5Loading] = useState(true)
  const [top5Error, setTop5Error] = useState<string | null>(null)

  const [video, setVideo] = useState<VideoContentBreakdown | null>(null)
  const [videoLoading, setVideoLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadTop5() {
      try {
        if (!cancelled) {
          setTop5Error(null)
        }
        const data = await fetchTop5Activities(top5Window)
        if (!cancelled) setTop5(data)
      } catch (err) {
        if (!cancelled) setTop5Error(err instanceof Error ? err.message : "Failed to load")
      } finally {
        if (!cancelled) setTop5Loading(false)
      }
    }

    setTop5Loading(true)
    loadTop5()
    const top5Timer = setInterval(loadTop5, 30_000)

    setVideoLoading(true)
    fetchVideoBreakdown({ todayOnly: true })
      .then((data) => { if (!cancelled) setVideo(data) })
      .catch(() => { if (!cancelled) setVideo(null) })
      .finally(() => { if (!cancelled) setVideoLoading(false) })

    return () => {
      cancelled = true
      clearInterval(top5Timer)
    }
  }, [top5Window])

  const refreshTop5 = () => {
    setTop5Loading(true)
    fetchTop5Activities(top5Window)
      .then((data) => setTop5(data))
      .catch((err) => setTop5Error(err instanceof Error ? err.message : "Failed"))
      .finally(() => setTop5Loading(false))
  }
  const productive = top5?.productiveTop5 ?? []
  const distracting = top5?.distractingTop5 ?? []

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col h-full">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">Activity Breakdown</h2>
        <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => setTop5Window("today")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${top5Window === "today" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setTop5Window("7d")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${top5Window === "7d" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
          >
            7 Days
          </button>
        </div>
      </div>
      <p className={`text-xs mb-4 ${top5?.stale ? "text-amber-600" : "text-gray-500"}`}>
        {formatLastUpdated(top5?.lastUpdated ?? null)}
        {top5?.stale ? " · Collector stale" : ""}
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* Productive Apps Column */}
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Productive Apps</h3>
          {top5Loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-5 h-5 rounded bg-gray-200" />
                    <div className="h-4 flex-1 bg-gray-100 rounded max-w-[80px]" />
                    <div className="h-4 w-12 bg-gray-100 rounded" />
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : productive.length > 0 ? (
            <div className="space-y-3">
              {productive.slice(0, TOP_DISTRACTING_COUNT).map((item) => (
                <div key={item.name}>
                  <div className="flex items-center gap-2 mb-1">
                    <SiteIcon name={item.name} />
                    <span className="text-sm text-gray-700 flex-1">{item.name}</span>
                    <span className="text-sm font-medium text-gray-500">{item.formattedTime}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#a3b18a] rounded-full transition-all duration-700"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No productive activity in this period.</p>
          )}
        </div>

        {/* Distracting Activities Column */}
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Distracting Activities</h3>
          {top5Loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-5 h-5 rounded bg-gray-200" />
                    <div className="h-4 flex-1 bg-gray-100 rounded max-w-[80px]" />
                    <div className="h-4 w-12 bg-gray-100 rounded" />
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : distracting.length > 0 ? (
            <div className="space-y-3">
              {distracting.slice(0, TOP_DISTRACTING_COUNT).map((activity) => (
                <div key={activity.name}>
                  <div className="flex items-center gap-2 mb-1">
                    <SiteIcon name={activity.name} />
                    <span className="text-sm text-gray-700 flex-1">{activity.name}</span>
                    <span className="text-sm font-medium text-gray-500">
                      {activity.formattedTime}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#d4a373] rounded-full transition-all duration-700"
                      style={{ width: `${activity.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {top5Error ? "Top-5 source unavailable right now." : "No distracting activity in this period."}
            </p>
          )}
        </div>
      </div>

      {/* Uncertain Activity Review */}
      <UncertainActivityReview onOverrideApplied={refreshTop5} />

      {/* Video Consumption */}
      <div className="mt-auto pt-6 border-t border-gray-100 flex-shrink-0">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Video Consumption</h3>
        {videoLoading ? (
          <div className="h-4 bg-gray-100 rounded-full animate-pulse" />
        ) : video && (video.shortFormSeconds > 0 || video.longFormSeconds > 0) ? (
          <>
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden flex">
              {video.longFormPercent > 0 && (
                <div
                  className="h-full bg-[#6b7f5e] transition-all duration-700"
                  style={{ width: `${video.longFormPercent}%`, borderRadius: video.shortFormPercent === 0 ? "9999px" : "9999px 0 0 9999px" }}
                />
              )}
              {video.shortFormPercent > 0 && (
                <div
                  className="h-full bg-[#d4a373] transition-all duration-700"
                  style={{ width: `${video.shortFormPercent}%`, borderRadius: video.longFormPercent === 0 ? "9999px" : "0 9999px 9999px 0" }}
                />
              )}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">{video.longFormPercent}% Long Form</span>
              <span className="text-xs text-gray-500">{video.shortFormPercent}% Short Form</span>
            </div>
            {video.entries.length > 0 && (
              <div className="mt-3 space-y-1">
                {video.entries.slice(0, 3).map((e) => (
                  <div key={e.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: e.type === "long" ? "#6b7f5e" : "#d4a373" }}
                      />
                      <span className="text-xs text-gray-600">{e.label}</span>
                    </div>
                    <span className="text-xs text-gray-400">{e.formattedTime}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-400">No video activity today.</p>
        )}
      </div>
    </div>
  )
}
