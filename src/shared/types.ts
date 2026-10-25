// Types shared by the main process, the preload and the UI.

export interface Character {
  id: number
  name: string
  world: string | null
  vocation: string | null
  level: number | null
  residence: string | null
  guild: string | null
  notes: string
  lastSyncedAt: string | null
  // Effective premium status: the manual choice if set, otherwise Tibia.com's (null = unknown).
  premium: boolean | null
  // Reported by Tibia.com on the last sync.
  premiumAuto: boolean | null
  // Player's manual choice (null = automatic).
  premiumOverride: boolean | null
  // Entered by the player; null = the app uses the typical value for the level.
  skills: CharacterSkills
  // Estimated typical value for the level; null for fields that do not matter for the vocation.
  typicalSkills: CharacterSkills
  sex: 'male' | 'female' | null
  // Default vocation outfit from the TibiaWiki (Tibia.com does not publish the character's look).
  outfitUrl: string | null
  // Image chosen by the player (data URL); takes precedence over the outfit.
  portrait: string | null
}

// All Tibia skills. null = not entered.
export interface CharacterSkills {
  magicLevel: number | null
  fist: number | null
  club: number | null
  sword: number | null
  axe: number | null
  distance: number | null
  shielding: number | null
  fishing: number | null
}

export const SKILL_KEYS = [
  'magicLevel',
  'fist',
  'club',
  'sword',
  'axe',
  'distance',
  'shielding',
  'fishing'
] as const satisfies readonly (keyof CharacterSkills)[]

export interface LevelEntry {
  level: number
  recordedAt: string
}

export type ProgressKind = 'quest' | 'access' | 'goal'
export type ProgressStatus = 'todo' | 'doing' | 'done'

export interface ProgressItem {
  id: number
  characterId: number
  kind: ProgressKind
  title: string
  status: ProgressStatus
  notes: string
  updatedAt: string
}

export interface Source {
  title: string
  heading: string
  url: string
}

export interface KnowledgeStats {
  pages: number
  chunks: number
  hunts: number
  creatures: number
  quests: number
  lastIngestAt: string | null
}

export interface IngestProgress {
  phase: 'listing' | 'fetching' | 'embedding' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export type Provider = 'claude' | 'ollama'

export interface SettingsView {
  hasApiKey: boolean
  apiKeyFromEnv: boolean
  provider: Provider
  ollamaModel: string
}

// TibiaWiki categories available for indexing.
export const WIKI_CATEGORIES = [
  { id: 'Creatures', label: 'Criaturas' },
  { id: 'Bosses', label: 'Bosses' },
  { id: 'Hunting Places', label: 'Hunting places' },
  { id: 'Quest Overview Pages', label: 'Quests' },
  { id: 'Spells', label: 'Magias' },
  { id: 'Achievements', label: 'Achievements' }
] as const

export interface Api {
  chat: {
    send(conversationId: string, text: string, characterId: number | null): Promise<void>
    reset(conversationId: string): Promise<void>
    onDelta(cb: (e: { conversationId: string; text: string }) => void): () => void
    onSources(cb: (e: { conversationId: string; sources: Source[] }) => void): () => void
    onDone(cb: (e: { conversationId: string; model: string; error?: string }) => void): () => void
  }
  characters: {
    list(): Promise<Character[]>
    add(name: string): Promise<Character>
    sync(id: number): Promise<Character>
    remove(id: number): Promise<void>
    saveNotes(id: number, notes: string): Promise<void>
    setPremiumOverride(id: number, premium: boolean | null): Promise<void>
    setSkills(id: number, skills: CharacterSkills): Promise<void>
    setPortrait(id: number, dataUrl: string | null): Promise<void>
    levelHistory(id: number): Promise<LevelEntry[]>
    progress(id: number): Promise<ProgressItem[]>
    addProgress(characterId: number, kind: ProgressKind, title: string): Promise<ProgressItem>
    setProgressStatus(id: number, status: ProgressStatus): Promise<void>
    removeProgress(id: number): Promise<void>
  }
  knowledge: {
    stats(): Promise<KnowledgeStats>
    ingest(categories: string[], maxPagesPerCategory: number | null): Promise<void>
    // Re-indexes only what changed on the wiki since the last update (TibiaData feed).
    update(): Promise<void>
    onProgress(cb: (p: IngestProgress) => void): () => void
  }
  settings: {
    get(): Promise<SettingsView>
    setApiKey(key: string): Promise<void>
    setProvider(provider: Provider, ollamaModel: string): Promise<void>
    // Models installed in Ollama; throws if Ollama is not running.
    ollamaModels(): Promise<string[]>
  }
}
