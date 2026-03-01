"use client"

export function FocusOverview() {
  const focusPercent = 75
  const thermometerHeight = 200
  const fillHeight = (focusPercent / 100) * thermometerHeight

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col h-full">
      <h2 className="text-lg font-bold text-gray-900 mb-6">Focus Meter</h2>

      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Thermometer */}
        <div className="relative flex flex-col items-center">
          {/* Bulb top */}
          <div className="w-14 h-7 rounded-t-full bg-gray-100 border border-gray-200 border-b-0 relative overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 bg-[#a3b18a]/30"
              style={{ height: "100%" }}
            />
          </div>

          {/* Thermometer tube */}
          <div
            className="w-14 bg-gray-100 border-x border-gray-200 relative overflow-hidden"
            style={{ height: `${thermometerHeight}px` }}
          >
            <div
              className="absolute bottom-0 left-0 right-0 transition-all duration-1000 ease-out"
              style={{
                height: `${fillHeight}px`,
                background: "linear-gradient(to top, #a3b18a, #c5d5a8)",
              }}
            />
            {/* Tick marks */}
            {[0, 25, 50, 75, 100].map((tick) => (
              <div
                key={tick}
                className="absolute left-0 right-0 border-t border-gray-300/50"
                style={{ bottom: `${(tick / 100) * thermometerHeight}px` }}
              />
            ))}
          </div>

          {/* Bulb bottom */}
          <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 -mt-2 relative overflow-hidden flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle, #a3b18a 60%, #c5d5a8 100%)",
              }}
            />
            <span className="relative text-white font-bold text-xs">
              {focusPercent}%
            </span>
          </div>
        </div>

        {/* Percentage text */}
        <div className="text-center mt-4">
          <span className="text-4xl font-bold text-gray-900">75%</span>
          <p className="text-sm text-gray-500 mt-0.5">Focus Score</p>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-center gap-8 mt-6 pt-4 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-[#a3b18a]"
          >
            <rect x="2" y="6" width="3" height="8" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="6.5" y="3" width="3" height="11" rx="1" fill="currentColor" opacity="0.7" />
            <rect x="11" y="1" width="3" height="13" rx="1" fill="currentColor" />
          </svg>
          <div>
            <p className="text-xs text-gray-500">Productive</p>
            <p className="text-sm font-bold text-gray-900">5h 25m</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-[#d4a373]"
          >
            <path
              d="M8 1L9.5 5H14L10.5 8L12 13L8 10L4 13L5.5 8L2 5H6.5L8 1Z"
              fill="currentColor"
            />
          </svg>
          <div>
            <p className="text-xs text-gray-500">Distracting</p>
            <p className="text-sm font-bold text-gray-900">2h 50m</p>
          </div>
        </div>
      </div>
    </div>
  )
}
