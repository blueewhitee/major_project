"use client"

import { useState, useEffect } from "react"
import { CheckCircle, XCircle } from "lucide-react"

export interface UncertainItem {
    key: string
    durationSeconds: number
    formattedTime: string
}

export function UncertainActivityReview({
    onOverrideApplied,
}: {
    onOverrideApplied?: () => void
}) {
    const [items, setItems] = useState<UncertainItem[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchUncertainItems()
    }, [])

    async function fetchUncertainItems() {
        try {
            setLoading(true)
            const res = await fetch("/api/activity/uncertain-top")
            const data = await res.json()
            setItems(data.uncertainItems || [])
        } catch (e) {
            console.error("Failed to fetch uncertain items", e)
        } finally {
            setLoading(false)
        }
    }

    async function handleOverride(key: string, classification: "PRODUCTIVE" | "DISTRACTIVE") {
        // Optimistic UI update
        setItems((prev) => prev.filter((item) => item.key !== key))

        try {
            await fetch("/api/activity/override", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key, classification }),
            })
            if (onOverrideApplied) onOverrideApplied()
        } catch (e) {
            console.error("Failed to override", e)
            // fetch back on failure
            fetchUncertainItems()
        }
    }

    if (loading || items.length === 0) return null

    return (
        <div className="mt-auto pt-6 border-t border-gray-100">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-700">Needs Review</h3>
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                    Uncategorized ({items.length})
                </span>
            </div>
            <div className="space-y-2">
                {items.map((item) => (
                    <div key={item.key} className="flex items-center justify-between bg-amber-50 rounded p-2 text-xs">
                        <div className="flex flex-col overflow-hidden mr-2">
                            <span className="font-medium text-gray-800 truncate" title={item.key}>{item.key}</span>
                            <span className="text-gray-500">{item.formattedTime} today</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                onClick={() => handleOverride(item.key, "PRODUCTIVE")}
                                className="p-1 rounded bg-white border border-gray-200 text-green-600 hover:bg-green-50 transition-colors tooltip tooltip-top"
                                title="Mark as Productive"
                            >
                                <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleOverride(item.key, "DISTRACTIVE")}
                                className="p-1 rounded bg-white border border-gray-200 text-red-600 hover:bg-red-50 transition-colors tooltip tooltip-top"
                                title="Mark as Distracting"
                            >
                                <XCircle className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
