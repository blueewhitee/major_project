import { FocusOverview } from "@/components/focus-overview"
import { ActivityBreakdown } from "@/components/activity-breakdown"
import { EfficiencyInsights } from "@/components/efficiency-insights"
import { ProductivityTimeline } from "@/components/productivity-timeline"

export default function OverviewPage() {
  return (
    <main className="min-h-screen bg-[#fafaf8] p-6 md:p-10">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-8 font-serif">
          Minimalist Focus Journal Dashboard
        </h1>

        {/* Top row: 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr] gap-4 mb-4">
          <FocusOverview />
          <ActivityBreakdown />
          <EfficiencyInsights />
        </div>

        {/* Bottom row: full width */}
        <ProductivityTimeline />
      </div>
    </main>
  )
}
