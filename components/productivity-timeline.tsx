"use client"

import { useEffect, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface ActivitySegment {
  start: string
  end: string
  category: "productive" | "distracting" | "inactive"
  label: string
}

type SlotType = "productive" | "distracting" | "inactive"

const COLOR_MAP: Record<SlotType, string> = {
  productive: "#A3B18A",
  distracting: "#E07A5F",
  inactive: "#F4F1DE",
}

const HOURS = 10
const SLOTS_PER_HOUR = 4
const TOTAL_SLOTS = HOURS * SLOTS_PER_HOUR

interface SlotInfo {
  type: SlotType
  labels: string[]
}

function segmentsToSlots(
  segments: ActivitySegment[],
  rangeStart: Date,
  rangeEnd: Date
): SlotInfo[] {
  const slots: SlotInfo[] = []
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime()

  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const slotStart = rangeStart.getTime() + (i / TOTAL_SLOTS) * rangeMs
    const slotEnd = slotStart + (rangeMs / TOTAL_SLOTS)

    const overlap: Record<SlotType, number> = {
      productive: 0,
      distracting: 0,
      inactive: 0,
    }
    const allLabels = new Set<string>()

    for (const seg of segments) {
      const segStart = new Date(seg.start).getTime()
      const segEnd = new Date(seg.end).getTime()
      const overlapStart = Math.max(segStart, slotStart)
      const overlapEnd = Math.min(segEnd, slotEnd)
      if (overlapStart < overlapEnd) {
        overlap[seg.category] += overlapEnd - overlapStart
        allLabels.add(seg.label)
      }
    }

    let type: SlotType
    const max = Math.max(overlap.productive, overlap.distracting, overlap.inactive)
    if (max === 0) {
      type = "inactive"
    } else if (overlap.distracting >= overlap.productive && overlap.distracting >= overlap.inactive) {
      type = "distracting"
    } else if (overlap.productive >= overlap.inactive) {
      type = "productive"
    } else {
      type = "inactive"
    }

    const labels = Array.from(allLabels)
    slots.push({ type, labels })
  }

  return slots
}

export function ProductivityTimeline() {
  const [data, setData] = useState<ActivitySegment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/activity/last-12h")
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error("Failed to fetch activity", err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const now = new Date()
  const tenHoursAgo = new Date(now.getTime() - HOURS * 60 * 60 * 1000)
  const slots = segmentsToSlots(data, tenHoursAgo, now)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 md:p-8">
      <h2 className="text-lg font-bold text-gray-900 mb-8">Day-at-a-Glance</h2>

      {loading ? (
        <div className="h-32 rounded-lg bg-gray-100 animate-pulse flex items-center justify-center">
          <span className="text-sm text-gray-500">Loading activity...</span>
        </div>
      ) : (
        <>
          <div className="relative">
            <div className="flex items-end gap-1 md:gap-2">
              {Array.from({ length: HOURS }, (_, hourIdx) => (
                <div
                  key={hourIdx}
                  className="flex-1 flex flex-row gap-[2px] rounded-md overflow-hidden"
                  style={{ height: "80px" }}
                >
                  {Array.from({ length: SLOTS_PER_HOUR }, (_, slotIdx) => {
                    const idx = hourIdx * SLOTS_PER_HOUR + slotIdx
                    const slot = slots[idx] ?? { type: "inactive" as SlotType, labels: [] }
                    const slotStart = new Date(
                      tenHoursAgo.getTime() + (idx / TOTAL_SLOTS) * (now.getTime() - tenHoursAgo.getTime())
                    )
                    const slotEnd = new Date(
                      tenHoursAgo.getTime() + ((idx + 1) / TOTAL_SLOTS) * (now.getTime() - tenHoursAgo.getTime())
                    )
                    const timeRange = `${slotStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${slotEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    const categoryLabel =
                      slot.type === "productive"
                        ? "Deep Work"
                        : slot.type === "distracting"
                          ? "Distraction"
                          : "Inactive"
                    return (
                      <Tooltip key={slotIdx}>
                        <TooltipTrigger asChild>
                          <div
                            className="flex-1 h-full rounded-[3px] transition-colors duration-300 min-w-0 cursor-default"
                            style={{ backgroundColor: COLOR_MAP[slot.type] }}
                          />
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-[220px] border border-gray-200 bg-white px-3 py-2.5 text-gray-700 shadow-md"
                        >
                          <p className="text-xs font-medium text-gray-500 mb-1">{timeRange}</p>
                          <p className="text-xs font-medium text-gray-500 mb-1.5 capitalize">
                            {categoryLabel}
                          </p>
                          {slot.labels.length > 0 ? (
                            <ul className="text-xs text-gray-700 space-y-0.5">
                              {slot.labels.map((label) => (
                                <li key={label} className="truncate">
                                  {label}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-gray-500">No activity</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="flex gap-1 md:gap-2 mt-3">
              {Array.from({ length: HOURS }, (_, i) => {
                const d = new Date(tenHoursAgo.getTime() + i * 60 * 60 * 1000)
                return (
                  <div key={i} className="flex-1 text-center">
                    <span className="text-[10px] md:text-xs text-gray-400 font-medium">
                      {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-6 mt-6 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#A3B18A" }} />
              <span className="text-xs text-gray-500">Deep Work</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#E07A5F" }} />
              <span className="text-xs text-gray-500">Distraction</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#F4F1DE" }} />
              <span className="text-xs text-gray-500">Inactive</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
