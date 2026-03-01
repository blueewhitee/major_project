export function EfficiencyInsights() {
  const insights = [
    { label: "Most Productive", value: "10 AM - 12 PM" },
    { label: "Most Distracting", value: "2 PM - 3 PM" },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col h-full">
      <h2 className="text-lg font-bold text-gray-900 mb-6">Efficiency Insights</h2>

      <div className="flex-1 flex flex-col justify-center space-y-4">
        {insights.map((insight) => (
          <p key={insight.label} className="text-sm text-gray-700">
            <span className="font-medium">{insight.label}:</span>{" "}
            <span>{insight.value}</span>
          </p>
        ))}

        <div className="pt-2">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Focus Peak:</span> 95% (11 AM)
          </p>
        </div>
      </div>
    </div>
  )
}
