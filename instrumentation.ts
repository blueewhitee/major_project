/**
 * Runs when the Next.js server starts.
 * Bootstraps the activity cache in the background so first requests are fast.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refreshInBackground } = await import("@/lib/activity-cache-refresh")
    refreshInBackground()
  }
}
