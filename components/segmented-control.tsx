"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

const TABS = ["Summary", "Category", "Timeline", "Settings"] as const
type Tab = (typeof TABS)[number]

interface SegmentedControlProps {
  value?: Tab
  onChange?: (value: Tab) => void
  className?: string
}

export function SegmentedControl({ value, onChange, className }: SegmentedControlProps) {
  const [internalActive, setInternalActive] = useState<Tab>("Summary")

  const activeTab = value ?? internalActive
  const activeIndex = TABS.indexOf(activeTab)

  function handleSelect(tab: Tab) {
    if (!value) setInternalActive(tab)
    onChange?.(tab)
  }

  return (
    <div
      className={cn(
        "relative inline-flex rounded-full border border-gray-200 bg-gray-100/80 p-1",
        className
      )}
    >
      {/* Sliding white background */}
      <div
        aria-hidden="true"
        className="absolute inset-y-1 rounded-[6px] bg-white shadow-sm transition-transform duration-200 ease-in-out"
        style={{
          width: `calc(100% / ${TABS.length} - 2px)`,
          left: "1px",
          transform: `translateX(calc(${activeIndex} * (100% + 2px)))`,
        }}
      />

      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => handleSelect(tab)}
          className={cn(
            "relative z-10 w-24 py-1.5 text-sm font-medium transition-colors duration-150 select-none",
            activeTab === tab ? "text-gray-900" : "text-gray-500 hover:text-gray-700"
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
