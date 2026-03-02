"use client"

import { useEffect, useState } from "react"
import { ArrowRight, PieChart, List, X } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ────────────────────────────────────────────────────────
type CategoryItem = {
  category: string
  categoryKey: string
  seconds: number
  percent: number
  formattedTime: string
}

type TransitionItem = {
  fromCategory: string
  fromCategoryKey: string
  toCategory: string
  toCategoryKey: string
  strength: number
  count: number
  description: string
}

type CategoriesData = {
  todayCategories: CategoryItem[]
  recapCategories?: CategoryItem[]
  allTimeCategories: CategoryItem[]
  transitions: TransitionItem[]
  stale: boolean
  staleMinutes: number | null
  lastUpdated: string | null
  generatedAt: string
}

type DrilldownScope = "today" | "7d"

type DrilldownItem = {
  name: string
  type: "site" | "app"
  durationSeconds: number
  percent: number
  eventCount: number
  formattedTime: string
}

// ── Per-category colour tokens ───────────────────────────────────
// Keys exactly match the lowercase strings returned by the backend.
const CAT: Record<
  string,
  {
    dot: string          // Tailwind bg-* class for the dot
    text: string         // Tailwind text-* class for the label
    badgeText: string    // Tailwind text-* for badge number
    badgeBg: string      // Tailwind bg-* + ring-* for badge background
    hex: string          // Hex for inline gradient / glow styles
    glowRgba: string     // rgba string for box-shadow glow
    title: string        // Short display title
    subtitle: string     // Descriptor subtitle (right panel)
  }
> = {
  "education": {
    dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-400",
    badgeText: "text-purple-600 dark:text-purple-400",
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/20 ring-1 ring-purple-500/20",
    hex: "#a855f7", glowRgba: "rgba(168,85,247,0.4)",
    title: "Education", subtitle: "Tech Tutorials",
  },
  "entertainment": {
    dot: "bg-pink-500", text: "text-pink-600 dark:text-pink-400",
    badgeText: "text-pink-600 dark:text-pink-400",
    badgeBg: "bg-pink-500/10 dark:bg-pink-500/20 ring-1 ring-pink-500/20",
    hex: "#ec4899", glowRgba: "rgba(236,72,153,0.4)",
    title: "Entertainment", subtitle: "Vlogs & Lifestyle",
  },
  "news": {
    dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400",
    badgeText: "text-blue-600 dark:text-blue-400",
    badgeBg: "bg-blue-500/10 dark:bg-blue-500/20 ring-1 ring-blue-500/20",
    hex: "#3b82f6", glowRgba: "rgba(59,130,246,0.4)",
    title: "News", subtitle: "Politics & World Affairs",
  },
  "music": {
    dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400",
    badgeText: "text-indigo-600 dark:text-indigo-400",
    badgeBg: "bg-indigo-500/10 dark:bg-indigo-500/20 ring-1 ring-indigo-500/20",
    hex: "#6366f1", glowRgba: "rgba(99,102,241,0.4)",
    title: "Music", subtitle: "Audio & Podcasts",
  },
  "gaming": {
    dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400",
    badgeText: "text-orange-600 dark:text-orange-400",
    badgeBg: "bg-orange-500/10 dark:bg-orange-500/20 ring-1 ring-orange-500/20",
    hex: "#f97316", glowRgba: "rgba(249,115,22,0.4)",
    title: "Gaming", subtitle: "Streaming & Live Content",
  },
  "shopping": {
    dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400",
    badgeText: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/20 ring-1 ring-amber-500/20",
    hex: "#eab308", glowRgba: "rgba(234,179,8,0.4)",
    title: "Shopping", subtitle: "Reviews & Recommendations",
  },
  "productivity": {
    dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/20 ring-1 ring-emerald-500/20",
    hex: "#10b981", glowRgba: "rgba(16,185,129,0.4)",
    title: "Productivity", subtitle: "Work & Tools",
  },
  "health": {
    dot: "bg-teal-500", text: "text-teal-600 dark:text-teal-400",
    badgeText: "text-teal-600 dark:text-teal-400",
    badgeBg: "bg-teal-500/10 dark:bg-teal-500/20 ring-1 ring-teal-500/20",
    hex: "#14b8a6", glowRgba: "rgba(20,184,166,0.4)",
    title: "Health", subtitle: "Lifestyle & Wellness",
  },
  "social": {
    dot: "bg-red-500", text: "text-red-600 dark:text-red-400",
    badgeText: "text-red-600 dark:text-red-400",
    badgeBg: "bg-red-500/10 dark:bg-red-500/20 ring-1 ring-red-500/20",
    hex: "#ef4444", glowRgba: "rgba(239,68,68,0.4)",
    title: "Social", subtitle: "Forums & Communities",
  },
  "finance": {
    dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400",
    badgeText: "text-cyan-600 dark:text-cyan-400",
    badgeBg: "bg-cyan-500/10 dark:bg-cyan-500/20 ring-1 ring-cyan-500/20",
    hex: "#06b6d4", glowRgba: "rgba(6,182,212,0.4)",
    title: "Finance", subtitle: "Business & Markets",
  },
}

function getCat(key: string) {
  return CAT[key.toLowerCase()] ?? null
}

function formatLastUpdated(ts: string | null): string {
  if (!ts) return "No data yet"
  try {
    const d = new Date(ts)
    return `Updated ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  } catch {
    return "Updated recently"
  }
}

// ── Skeleton helpers ─────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="grid grid-cols-12 gap-4 px-6 py-5 items-center rounded-2xl bg-white/50 dark:bg-slate-900/30 animate-pulse">
      <div className="col-span-3 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-700" />
        <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="col-span-1 flex justify-center">
        <div className="w-5 h-5 bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="col-span-3 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-700" />
        <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="col-span-2 flex items-center gap-3">
        <div className="flex-1 h-2.5 bg-gray-200 dark:bg-slate-700 rounded-full" />
        <div className="h-4 w-8 bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="col-span-3">
        <div className="h-4 w-full bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
    </div>
  )
}

function SkeletonCategoryItem({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-center justify-between animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-slate-700" />
        <div className={cn("h-4 bg-gray-200 dark:bg-slate-700 rounded", wide ? "w-40" : "w-28")} />
      </div>
      <div className="h-6 w-12 bg-gray-200 dark:bg-slate-700 rounded-full" />
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
export function CategoryBreakdown() {
  const [data, setData] = useState<CategoriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [drilldownOpen, setDrilldownOpen] = useState(false)
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownCategoryTitle, setDrilldownCategoryTitle] = useState("")
  const [drilldownScope, setDrilldownScope] = useState<DrilldownScope>("today")
  const [drilldownItems, setDrilldownItems] = useState<DrilldownItem[]>([])

  useEffect(() => {
    fetch("/api/activity/categories")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const recapCategories = data?.recapCategories ?? data?.allTimeCategories ?? []

  function openDrilldown(categoryKey: string, scope: DrilldownScope) {
    const cat = getCat(categoryKey)
    setDrilldownCategoryTitle(cat?.title ?? categoryKey)
    setDrilldownScope(scope)
    setDrilldownOpen(true)
    setDrilldownLoading(true)
    fetch(`/api/activity/category-items?category=${encodeURIComponent(categoryKey)}&scope=${scope}`)
      .then((r) => r.json())
      .then((d) => setDrilldownItems((d?.topItems ?? []) as DrilldownItem[]))
      .catch(() => setDrilldownItems([]))
      .finally(() => setDrilldownLoading(false))
  }

  return (
    <div
      className="space-y-6"
      style={{
        backgroundImage:
          "radial-gradient(at 0% 0%, rgba(167,139,250,0.07) 0, transparent 60%), " +
          "radial-gradient(at 50% 0%, rgba(52,211,153,0.07) 0, transparent 60%), " +
          "radial-gradient(at 100% 0%, rgba(236,72,153,0.07) 0, transparent 60%)",
      }}
    >
      {/* Stale indicator */}
      {data?.stale && (
        <p className="text-xs text-amber-600">
          {formatLastUpdated(data.lastUpdated)} · Collector stale
        </p>
      )}

      {/* ── Transitions section ────────────────────────────────── */}
      <section className="rounded-3xl border border-white/60 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/40 backdrop-blur-md shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100/60 dark:border-slate-800/50 bg-white/40 dark:bg-transparent">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Category Transitions
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Shifts from productive to distracting behaviour, ranked by frequency.
          </p>
        </div>

        <div className="p-4 md:p-6">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-4 px-6 mb-5 text-[11px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">
            <div className="col-span-3">From (Productive)</div>
            <div className="col-span-1" />
            <div className="col-span-3">To (Distraction)</div>
            <div className="col-span-2">Strength</div>
            <div className="col-span-3">Description</div>
          </div>

          <div className="space-y-3">
            {loading
              ? [1, 2, 3].map((i) => <SkeletonRow key={i} />)
              : (data?.transitions ?? []).length === 0
              ? (
                <div className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  No transition data yet — keep browsing and the model will learn your patterns.
                </div>
              )
              : data!.transitions.map((t, i) => {
                  const from = getCat(t.fromCategoryKey)
                  const to   = getCat(t.toCategoryKey)
                  if (!from || !to) return null
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-12 gap-4 px-6 py-5 items-center bg-white/50 dark:bg-slate-900/30 rounded-2xl hover:bg-white/80 dark:hover:bg-slate-800/40 transition-all border border-transparent hover:border-slate-200/50 dark:hover:border-slate-700/50 shadow-sm"
                    >
                      {/* From */}
                      <button
                        type="button"
                        onClick={() => openDrilldown(t.fromCategoryKey, "7d")}
                        className={cn("col-span-3 font-semibold flex items-center gap-2 text-left hover:opacity-80 transition-opacity", from.text)}
                      >
                        <span className={cn("w-2 h-2 rounded-full shrink-0", from.dot)} />
                        {CAT[t.fromCategoryKey]?.title ?? t.fromCategory}
                      </button>

                      {/* Arrow */}
                      <div className="col-span-1 flex justify-center">
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                      </div>

                      {/* To */}
                      <button
                        type="button"
                        onClick={() => openDrilldown(t.toCategoryKey, "7d")}
                        className={cn("col-span-3 font-semibold flex items-center gap-2 text-left hover:opacity-80 transition-opacity", to.text)}
                      >
                        <span className={cn("w-2 h-2 rounded-full shrink-0", to.dot)} />
                        {CAT[t.toCategoryKey]?.title ?? t.toCategory}
                      </button>

                      {/* Strength bar */}
                      <div className="col-span-2 flex items-center gap-3">
                        <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(t.strength * 100)}%`,
                              background: `linear-gradient(to right, ${from.hex}, ${to.hex})`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400 tabular-nums">
                          {t.strength.toFixed(2)}
                        </span>
                      </div>

                      {/* Description */}
                      <div className="col-span-3 text-sm text-slate-500 dark:text-slate-400 font-light italic">
                        {t.description}
                      </div>
                    </div>
                  )
                })}
          </div>
        </div>
      </section>

      {/* ── Bottom two panels ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Left: All Top Categories (today) */}
        <section className="rounded-3xl border border-white/60 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/40 backdrop-blur-md p-8 shadow-xl shadow-indigo-500/5">
          <h3 className="text-base font-semibold mb-7 text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-indigo-500" />
            All Top Categories
            <span className="ml-auto text-xs font-normal text-slate-400">Today</span>
          </h3>

          <div className="space-y-5">
            {loading
              ? [1, 2, 3, 4, 5, 6].map((i) => <SkeletonCategoryItem key={i} />)
              : (data?.todayCategories ?? []).length === 0
              ? <p className="text-sm text-slate-400 dark:text-slate-500">No activity recorded today yet.</p>
              : data!.todayCategories.map((item, i) => {
                  const c = getCat(item.categoryKey)
                  if (!c) return null
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => openDrilldown(item.categoryKey, "today")}
                      className="w-full flex items-center justify-between group text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn("w-3 h-3 rounded-full shrink-0", c.dot)}
                          style={{ boxShadow: `0 0 10px ${c.glowRgba}` }}
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {c.title}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "px-3 py-1 text-xs font-bold rounded-full tabular-nums",
                          c.badgeText, c.badgeBg
                        )}
                      >
                        {item.percent}%
                      </span>
                    </button>
                  )
                })}
          </div>
        </section>

        {/* Right: Dominant Topics Recap (all-time) */}
        <section className="rounded-3xl border border-white/60 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/40 backdrop-blur-md p-8 shadow-xl shadow-indigo-500/5">
          <h3 className="text-base font-semibold mb-7 text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <List className="w-5 h-5 text-emerald-500" />
            Dominant Topics Recap
            <span className="ml-auto text-xs font-normal text-slate-400">Last 7 days</span>
          </h3>

          <div className="space-y-5">
            {loading
              ? [1, 2, 3, 4, 5].map((i) => <SkeletonCategoryItem key={i} wide />)
              : recapCategories.length === 0
              ? <p className="text-sm text-slate-400 dark:text-slate-500">No categorised data yet.</p>
              : recapCategories.map((item, i) => {
                  const c = getCat(item.categoryKey)
                  if (!c) return null
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => openDrilldown(item.categoryKey, "7d")}
                      className="w-full flex items-start justify-between text-left"
                    >
                      <div className="flex gap-4">
                        <div
                          className={cn("mt-0.5 w-2.5 h-2.5 rounded-full shrink-0", c.dot)}
                          style={{ boxShadow: `0 0 8px ${c.glowRgba}` }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-white leading-none">
                            {c.title}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 font-medium uppercase tracking-wider">
                            {c.subtitle}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "px-3 py-1 text-xs font-bold rounded-full tabular-nums shrink-0",
                          c.badgeText, c.badgeBg
                        )}
                      >
                        {item.percent}%
                      </span>
                    </button>
                  )
                })}
          </div>
        </section>

      </div>

      {/* Drilldown modal/drawer */}
      {drilldownOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/30"
            onClick={() => setDrilldownOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {drilldownCategoryTitle}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Top 5 apps/sites · {drilldownScope === "today" ? "Today" : "Last 7 days"}
                </p>
              </div>
              <button
                type="button"
                className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setDrilldownOpen(false)}
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="space-y-3">
              {drilldownLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="animate-pulse rounded-xl border border-slate-200/70 dark:border-slate-700/60 p-3">
                    <div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded mb-2" />
                    <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded" />
                  </div>
                ))
              ) : drilldownItems.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No items found for this category in the selected window.
                </p>
              ) : (
                drilldownItems.map((item, i) => (
                  <div key={`${item.type}-${item.name}-${i}`} className="rounded-xl border border-slate-200/70 dark:border-slate-700/60 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {item.name}
                        </p>
                        <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {item.type}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                        {item.percent}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{item.formattedTime}</span>
                      <span>{item.eventCount} events</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
