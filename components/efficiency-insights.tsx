"use client"

import { useEffect, useState } from "react"

interface EfficiencyData {
  mostProductive: string
  mostDistracting: string
  focusPeakPercent: number
  focusPeakHour: string
  sampleSize: number
}

export function EfficiencyInsights() {
  const [data, setData] = useState<EfficiencyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/activity/efficiency-insights")
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col h-full">
      <h2 className="text-lg font-bold text-gray-900 mb-6">Efficiency Insights</h2>

      <div className="flex-1 flex flex-col justify-center space-y-4">
        <p className="text-sm text-gray-700">
          <span className="font-medium">Most Productive:</span>{" "}
          <span>{loading ? "..." : (data?.mostProductive ?? "N/A")}</span>
        </p>
        <p className="text-sm text-gray-700">
          <span className="font-medium">Most Distracting:</span>{" "}
          <span>{loading ? "..." : (data?.mostDistracting ?? "N/A")}</span>
        </p>

        <div className="pt-2">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Focus Peak:</span>{" "}
            {loading ? "..." : `${data?.focusPeakPercent ?? 0}% (${data?.focusPeakHour ?? "N/A"})`}
          </p>
          {!loading && (
            <p className="text-xs text-gray-400 mt-1">
              Based on {data?.sampleSize ?? 0} classified events today.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
