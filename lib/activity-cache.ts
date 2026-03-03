/**
 * File-based cache for activity data to avoid on-demand classification bottlenecks.
 * Background refresh runs asynchronously; API routes return cached data immediately.
 */

import { promises as fs } from "node:fs"
import path from "node:path"

const CACHE_DIR =
  process.env.ACTIVITY_CACHE_DIR ??
  path.join(process.cwd(), "model_server", "cache")
const CACHE_TTL_MS = 90_000 // 90 seconds — consider cache fresh
const REFRESH_DEBOUNCE_MS = 30_000 // Don't refresh more than once per 30s

type CacheKey =
  | "entertainment-today"
  | "entertainment-week"
  | "entertainment-month"
  | "focus-today"
  | "last-12h"
  | "web-events-today"

interface CacheEntry<T> {
  data: T
  updatedAt: string
}

let lastRefreshAttempt = 0

function cachePath(key: CacheKey): string {
  return path.join(CACHE_DIR, `${key}.json`)
}

export async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

export async function readCache<T>(key: CacheKey): Promise<CacheEntry<T> | null> {
  try {
    const raw = await fs.readFile(cachePath(key), "utf-8")
    const entry = JSON.parse(raw) as CacheEntry<T>
    return entry
  } catch {
    return null
  }
}

export async function writeCache<T>(
  key: CacheKey,
  data: T,
): Promise<void> {
  await ensureCacheDir()
  const entry: CacheEntry<T> = { data, updatedAt: new Date().toISOString() }
  await fs.writeFile(cachePath(key), JSON.stringify(entry), "utf-8")
}

export function isCacheFresh(updatedAt: string): boolean {
  const age = Date.now() - new Date(updatedAt).getTime()
  return age < CACHE_TTL_MS
}

export function shouldTriggerRefresh(): boolean {
  const now = Date.now()
  if (now - lastRefreshAttempt < REFRESH_DEBOUNCE_MS) return false
  lastRefreshAttempt = now
  return true
}
