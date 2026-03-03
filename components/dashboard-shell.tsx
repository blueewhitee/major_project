"use client"

import { useState } from "react"
import { SegmentedControl } from "@/components/segmented-control"
import { FocusOverview } from "@/components/focus-overview"
import { ActivityBreakdown } from "@/components/activity-breakdown"
import { EfficiencyInsights } from "@/components/efficiency-insights"
import { ProductivityTimeline } from "@/components/productivity-timeline"
import { CategoryBreakdown } from "@/components/category-breakdown"
import { TriggerAnalysisFeed } from "@/components/trigger-analysis-feed"

const TABS = ["Summary", "Category", "Timeline", "Settings"] as const
type Tab = (typeof TABS)[number]

export function DashboardShell() {
  const [activeTab, setActiveTab] = useState<Tab>("Summary")

  return (
    <main className="min-h-screen bg-[#fafaf8] p-6 md:p-10">
      <div className="mx-auto max-w-7xl">

        {/* Header: title pinned left, segmented control absolutely centered */}
        <div className="relative flex items-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 font-serif">
            Carpe Diem
          </h1>
          <div className="absolute left-1/2 -translate-x-1/2">
            <SegmentedControl value={activeTab} onChange={setActiveTab} />
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "Summary" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr] gap-4 mb-4">
              <FocusOverview />
              <ActivityBreakdown />
              <EfficiencyInsights />
            </div>
            <ProductivityTimeline />
          </>
        )}

        {activeTab === "Category" && <CategoryBreakdown />}

        {activeTab === "Timeline" && (
          <TriggerAnalysisFeed />
        )}

        {activeTab === "Settings" && (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
            Settings coming soon.
          </div>
        )}

      </div>
    </main>
  )
}
