"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

interface EntertainmentEntry {
  label: string
  trigger: string
  totalSeconds: number
  visitCount: number
  avgSessionSeconds: number
  formattedTime: string
}

interface EntertainmentResponse {
  byTrigger: Record<string, number>
  entries: EntertainmentEntry[]
  totalSeconds: number
}

interface TitleItem {
  title: string
  totalSeconds: number
  visitCount: number
  formattedTime: string
}

const BUBBLE_SLOTS = [
  {
    wrapper: "absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2",
    size: "bubble-lg",
    tone: "bubble-rose",
  },
  { wrapper: "absolute top-[18%] right-[15%] z-10", size: "bubble-md", tone: "bubble-indigo" },
  { wrapper: "absolute bottom-[18%] left-[12%] z-10", size: "bubble-md", tone: "bubble-amber" },
  { wrapper: "absolute top-[28%] left-[18%]", size: "bubble-sm", tone: "bubble-teal" },
  { wrapper: "absolute bottom-[28%] right-[22%]", size: "bubble-sm", tone: "bubble-blue" },
  { wrapper: "absolute top-[12%] left-[48%]", size: "bubble-xs", tone: "bubble-slate" },
  { wrapper: "absolute bottom-[12%] right-[42%]", size: "bubble-xs", tone: "bubble-sage" },
] as const

const BADGE_TONES = [
  "bg-rose-50 text-rose-600 border border-rose-100",
  "bg-indigo-50 text-indigo-600 border border-indigo-100",
  "bg-amber-50 text-amber-700 border border-amber-100",
  "bg-teal-50 text-teal-700 border border-teal-100",
  "bg-slate-100 text-slate-700 border border-slate-200",
]

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

function initials(label: string) {
  const parts = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  if (parts.length === 0) return "--"
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function titleCaseFromSlug(value: string) {
  return value
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-")
}

type RangeOption = "today" | "week" | "month"

export function TriggerAnalysisFeed() {
  const [data, setData] = useState<EntertainmentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeOption>("today")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [titles, setTitles] = useState<TitleItem[]>([])
  const [titlesLoading, setTitlesLoading] = useState(false)

  useEffect(() => {
    async function fetchEntertainment() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(
          `/api/activity/entertainment-triggers?range=${range}`,
          { cache: "no-store" },
        )

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const json = (await response.json()) as EntertainmentResponse
        setData(json)
      } catch (fetchError) {
        console.error("Failed to fetch entertainment triggers", fetchError)
        setError("Unable to load trigger data right now.")
      } finally {
        setLoading(false)
      }
    }

    fetchEntertainment()
  }, [range])

  useEffect(() => {
    if (!selectedLabel) return
    let cancelled = false
    async function fetchTitles() {
      setTitlesLoading(true)
      setTitles([])
      try {
        const res = await fetch(
          `/api/activity/entertainment-triggers/${encodeURIComponent(selectedLabel)}/titles`,
          { cache: "no-store" },
        )
        if (!res.ok) throw new Error("Failed to fetch titles")
        const json = (await res.json()) as { titles: TitleItem[] }
        if (!cancelled) setTitles(json.titles ?? [])
      } catch {
        if (!cancelled) setTitles([])
      } finally {
        if (!cancelled) setTitlesLoading(false)
      }
    }
    fetchTitles()
    return () => {
      cancelled = true
    }
  }, [selectedLabel])

  const triggerPairs = useMemo(() => {
    const source = data?.byTrigger ?? {}
    return Object.entries(source).sort((a, b) => b[1] - a[1])
  }, [data])

  const bubbleTriggers = useMemo(() => {
    const filled = triggerPairs.slice(0, BUBBLE_SLOTS.length)
    while (filled.length < BUBBLE_SLOTS.length) {
      filled.push(["no-data", 0])
    }
    return filled
  }, [triggerPairs])

  const listEntries = data?.entries ?? []

  return (
    <div className="w-full max-w-7xl mx-auto pt-5 md:pt-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 xl:gap-10 items-start">
        <div className="lg:col-span-5 flex flex-col">
          <div className="mb-8 pl-4 border-l-2 border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Trigger <span className="font-bold text-gray-700">Heatmap</span>
            </h2>
            <p className="text-sm text-gray-500 mt-2">Visualizing weight of distraction sources</p>
          </div>

          <div className="relative h-[500px] w-full flex items-center justify-center bg-slate-50 rounded-[32px] border border-slate-100/50 shadow-sm">
            <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
              <div className="w-[450px] h-[450px] border border-slate-200 rounded-full absolute" />
              <div className="w-[300px] h-[300px] border border-slate-200 rounded-full absolute" />
            </div>

            <div className="relative w-full h-full">
              {bubbleTriggers.map(([trigger, seconds], index) => {
                const slot = BUBBLE_SLOTS[index]
                const isPrimary = index === 0
                const display = trigger === "no-data" ? "-" : titleCaseFromSlug(trigger)

                return (
                  <div key={`${trigger}-${index}`} className={slot.wrapper}>
                    <div className={`bubble ${slot.size} ${slot.tone}`}>
                      <div className="flex flex-col items-center px-2">
                        <span className="truncate max-w-full">{display}</span>
                        {isPrimary ? (
                          <span className="text-[0.65rem] opacity-70 font-semibold uppercase tracking-wide mt-1">
                            Highest Load
                          </span>
                        ) : (
                          <span className="text-[0.65rem] opacity-70 font-medium mt-1">{formatSeconds(seconds)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col h-full">
          <div className="mb-8 flex justify-between items-end px-2 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                Activity <span className="font-bold text-gray-700">Feed</span>
              </h2>
              <p className="text-sm text-gray-500 mt-2">Recent focus interruptions</p>
            </div>
            <Select value={range} onValueChange={(v) => setRange(v as RangeOption)}>
              <SelectTrigger className="w-[120px] text-gray-600 border-gray-200">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 overflow-y-auto pr-2 max-h-[500px] pb-2">
            {loading ? (
              <div className="clean-card rounded-2xl p-6 text-sm text-gray-500">Loading activity feed...</div>
            ) : error ? (
              <div className="clean-card rounded-2xl p-6 text-sm text-rose-600">{error}</div>
            ) : listEntries.length === 0 ? (
              <div className="clean-card rounded-2xl p-6 text-sm text-gray-500">No entertainment triggers found.</div>
            ) : (
              listEntries.map((item, index) => {
                const badgeTone = BADGE_TONES[index % BADGE_TONES.length]
                const isTop = index === 0

                return (
                  <div
                    key={`${item.label}-${item.trigger}-${index}`}
                    role="button"
                    tabIndex={0}
                    className="clean-card rounded-2xl p-6 group cursor-pointer"
                    onClick={() => {
                      setSelectedLabel(item.label)
                      setDrawerOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSelectedLabel(item.label)
                        setDrawerOpen(true)
                      }
                    }}
                  >
                    <div className="flex items-center gap-6">
                      <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center text-gray-700 font-bold text-lg border border-gray-200 shadow-sm group-hover:scale-105 transition-transform">
                        {initials(item.label)}
                      </div>

                      <div className="flex-grow min-w-0">
                        <div className="flex justify-between items-start gap-3">
                          <h3 className="text-base font-bold text-gray-900 truncate">{item.label}</h3>
                          <span className="text-lg font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                            {item.formattedTime}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[0.7rem] font-bold uppercase tracking-wider flex items-center gap-1.5 ${badgeTone}`}
                          >
                            {isTop && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />}
                            {item.trigger}
                          </span>
                          <span className="text-xs text-gray-500 font-medium">
                            {item.visitCount} Visits • {formatSeconds(item.avgSessionSeconds)} avg
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <Sheet open={drawerOpen} onOpenChange={(open) => setDrawerOpen(open)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>
              {selectedLabel ?? "Activity details"} · Today
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 flex flex-col gap-3">
            {titlesLoading ? (
              <p className="text-sm text-gray-500">Loading titles...</p>
            ) : titles.length === 0 ? (
              <p className="text-sm text-gray-500">No titles found for today.</p>
            ) : (
              titles.map((t, i) => (
                <div
                  key={`${t.title}-${i}`}
                  className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 text-sm"
                >
                  <p className="font-medium text-gray-900 line-clamp-2">
                    {t.title}
                  </p>
                  <p className="mt-1.5 text-xs text-gray-500">{t.formattedTime}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <style jsx>{`
        .bubble {
          border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          font-weight: 500;
          backdrop-filter: blur(8px);
          transition: all 0.5s ease-in-out;
          animation: float 6s ease-in-out infinite;
          position: relative;
          overflow: hidden;
          box-shadow: 0 4px 20px 0 rgb(15 23 42 / 0.08);
        }

        .bubble::after {
          content: "";
          position: absolute;
          top: 10%;
          left: 15%;
          width: 30%;
          height: 20%;
          border-radius: 9999px;
          background: rgb(255 255 255 / 0.4);
          filter: blur(4px);
          transform: rotate(-45deg);
        }

        .bubble:hover {
          transform: scale(1.03);
          z-index: 10;
          border-radius: 9999px;
          box-shadow: 0 10px 25px -5px rgb(15 23 42 / 0.15);
        }

        @keyframes float {
          0% {
            transform: translate(0, 0px);
            border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
          }

          50% {
            transform: translate(0, -10px);
            border-radius: 60% 40% 30% 70% / 50% 40% 50% 60%;
          }

          100% {
            transform: translate(0, 0px);
            border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
          }
        }

        .bubble-lg {
          width: 180px;
          height: 180px;
          font-size: 1.15rem;
        }

        .bubble-md {
          width: 140px;
          height: 140px;
          font-size: 1rem;
          animation-delay: 1s;
        }

        .bubble-sm {
          width: 100px;
          height: 100px;
          font-size: 0.85rem;
          animation-delay: 2s;
        }

        .bubble-xs {
          width: 80px;
          height: 80px;
          font-size: 0.75rem;
          animation-delay: 0.5s;
          opacity: 0.9;
        }

        .bubble-rose {
          background: linear-gradient(135deg, rgb(255 228 230), rgb(254 205 211));
          color: rgb(136 19 55);
        }

        .bubble-indigo {
          background: linear-gradient(135deg, rgb(243 232 255), rgb(221 214 254));
          color: rgb(76 29 149);
        }

        .bubble-blue {
          background: linear-gradient(135deg, rgb(219 234 254), rgb(191 219 254));
          color: rgb(30 58 138);
        }

        .bubble-amber {
          background: linear-gradient(135deg, rgb(254 243 199), rgb(253 230 138));
          color: rgb(120 53 15);
        }

        .bubble-sage {
          background: linear-gradient(135deg, rgb(226 232 240), rgb(203 213 225));
          color: rgb(51 65 85);
        }

        .bubble-slate {
          background: linear-gradient(135deg, rgb(241 245 249), rgb(203 213 225));
          color: rgb(51 65 85);
        }

        .bubble-teal {
          background: linear-gradient(135deg, rgb(204 251 241), rgb(153 246 228));
          color: rgb(17 94 89);
        }

        .clean-card {
          background: rgb(255 255 255 / 0.7);
          backdrop-filter: blur(12px);
          border: 1px solid rgb(241 245 249);
          box-shadow: 0 2px 10px rgb(15 23 42 / 0.04);
          transition: all 0.3s ease;
        }

        .clean-card:hover {
          background: rgb(255 255 255 / 0.95);
          box-shadow: 0 10px 30px -10px rgb(15 23 42 / 0.16);
          border-color: rgb(226 232 240);
        }
      `}</style>
    </div>
  )
}
