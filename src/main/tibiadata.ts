// Client for the public TibiaData API (https://tibiadata.bytewizards.de): a structured mirror
// of the TibiaWiki. Not to be confused with api.tibiadata.com, used for characters (characters.ts).

const BASE = 'https://tibiadata.bytewizards.de'
const USER_AGENT = 'DungeonGuideAI/0.1 (Tibia companion app prototype)'
const TIMEOUT_MS = 20_000

export async function tdGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`TibiaData respondeu ${res.status} em ${url.pathname}`)
  return (await res.json()) as T
}

// API dates are UTC but lack the "Z".
export const utc = (s: string): string => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`)

export async function dataVersion(): Promise<{ latestDataUpdateUtc: string }> {
  return tdGet('/api/v1/meta/version')
}

// --- Delta: what changed since a date -------------------------------------------

export interface DeltaChange {
  resource: string
  identifier: string
  updatedAtUtc: string
  changeType: string
}

export interface DeltaFeed {
  latestChangeUtc: string | null
  hasMore: boolean
  changes: DeltaChange[]
}

// The feed is newest first and cannot be paged backwards: with hasMore, the older changes
// were left out and only a full re-index fixes it.
export async function delta(since: string, resources: string[]): Promise<DeltaFeed> {
  return tdGet('/api/v1/meta/delta', { since, resources: resources.join(','), limit: '500' })
}

// --- Creatures -------------------------------------------------------------------

export interface ApiCreature {
  name: string
  hitpoints: number
  experience: number
  structuredData?: { infobox?: Record<string, string | null> }
  lootStatistics?: { itemName: string; chance: string | null; rarity: string | null }[]
}

export async function creature(name: string): Promise<ApiCreature> {
  return tdGet(`/api/v1/creatures/${encodeURIComponent(name)}`)
}

// --- Search and details (chat tools) ----------------------------------------------

export interface SearchItem {
  kind: string
  title: string
  summary: string | null
  route: string
  wikiUrl: string | null
}

export async function search(query: string, limit = 10): Promise<{ totalCount: number; items: SearchItem[] }> {
  return tdGet('/api/v1/search', { query, limit: String(limit) })
}

// Only read routes of this API; the route comes from the model, so it must not point elsewhere.
export function isAllowedRoute(route: string): boolean {
  return /^\/api\/v1\/[\w\-/%().,'!~*]+$/.test(route) && !route.includes('..')
}
