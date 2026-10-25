import { getDb } from './db'
import { typicalSkills, vocationGroup, type VocationGroup } from './rag/risk'
import { SKILL_KEYS } from '../shared/types'
import type {
  Character,
  CharacterSkills,
  LevelEntry,
  ProgressItem,
  ProgressKind,
  ProgressStatus
} from '../shared/types'

interface CharacterRow {
  id: number
  name: string
  world: string | null
  vocation: string | null
  level: number | null
  residence: string | null
  guild: string | null
  notes: string
  last_synced_at: string | null
  account_status: string | null
  premium_override: number | null
  magic_level: number | null
  skill_fist: number | null
  skill_club: number | null
  skill_sword: number | null
  skill_axe: number | null
  skill_distance: number | null
  skill_shielding: number | null
  skill_fishing: number | null
  sex: string | null
  outfit_url: string | null
  portrait: string | null
}

// Database column for each skill.
const SKILL_COLUMN: Record<keyof CharacterSkills, keyof CharacterRow> = {
  magicLevel: 'magic_level',
  fist: 'skill_fist',
  club: 'skill_club',
  sword: 'skill_sword',
  axe: 'skill_axe',
  distance: 'skill_distance',
  shielding: 'skill_shielding',
  fishing: 'skill_fishing'
}

interface ProgressRow {
  id: number
  character_id: number
  kind: ProgressKind
  title: string
  status: ProgressStatus
  notes: string
  updated_at: string
}

const toCharacter = (r: CharacterRow): Character => {
  const premiumAuto = r.account_status ? /premium/i.test(r.account_status) : null
  const premiumOverride = r.premium_override === null ? null : r.premium_override === 1
  return {
    id: r.id,
    name: r.name,
    world: r.world,
    vocation: r.vocation,
    level: r.level,
    residence: r.residence,
    guild: r.guild,
    notes: r.notes,
    lastSyncedAt: r.last_synced_at,
    premium: premiumOverride ?? premiumAuto,
    premiumAuto,
    premiumOverride,
    skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, r[SKILL_COLUMN[k]]])) as unknown as CharacterSkills,
    typicalSkills: relevantTypicalSkills(r.vocation, r.level),
    sex: r.sex === 'male' || r.sex === 'female' ? r.sex : null,
    outfitUrl: r.outfit_url,
    portrait: r.portrait
  }
}

// Only the fields the risk model uses for the vocation, with the typical value for the level.
function relevantTypicalSkills(vocation: string | null, level: number | null): CharacterSkills {
  const none = Object.fromEntries(SKILL_KEYS.map((k) => [k, null])) as unknown as CharacterSkills
  const group = vocationGroup(vocation)
  if (!group || !level) return none
  const t = typicalSkills(group, level)
  switch (group) {
    case 'knight':
      // The knight's weapon is unknown, so the typical value applies to all three.
      return { ...none, club: t.offense, sword: t.offense, axe: t.offense, shielding: t.shielding }
    case 'paladin':
      return { ...none, distance: t.offense, shielding: t.shielding }
    case 'monk':
      return { ...none, fist: t.offense }
    default:
      return { ...none, magicLevel: t.offense }
  }
}

const toProgress = (r: ProgressRow): ProgressItem => ({
  id: r.id,
  characterId: r.character_id,
  kind: r.kind,
  title: r.title,
  status: r.status,
  notes: r.notes,
  updatedAt: r.updated_at
})

export function listCharacters(): Character[] {
  const rows = getDb().prepare('SELECT * FROM characters ORDER BY name').all() as CharacterRow[]
  return rows.map(toCharacter)
}

export function getCharacter(id: number): Character | null {
  const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as
    | CharacterRow
    | undefined
  return row ? toCharacter(row) : null
}

// Public character data via the TibiaData API v4 (https://tibiadata.com).
interface TibiaDataCharacter {
  name: string
  world: string
  vocation: string
  level: number
  residence: string
  sex?: string
  guild?: { name?: string; rank?: string }
  account_status?: string // "Premium Account" | "Free Account"
}

async function fetchTibiaData(name: string): Promise<TibiaDataCharacter> {
  const res = await fetch(`https://api.tibiadata.com/v4/character/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`TibiaData respondeu ${res.status}`)
  const body = (await res.json()) as { character?: { character?: TibiaDataCharacter } }
  const c = body.character?.character
  if (!c?.name) throw new Error(`Personagem "${name}" não encontrado no Tibia.com`)
  return c
}

function applySync(id: number, c: TibiaDataCharacter): void {
  const db = getDb()
  const now = new Date().toISOString()
  const prev = db.prepare('SELECT level FROM characters WHERE id = ?').get(id) as
    | { level: number | null }
    | undefined
  db.prepare(
    `UPDATE characters SET name = ?, world = ?, vocation = ?, level = ?, residence = ?, guild = ?,
     account_status = ?, sex = ?, last_synced_at = ? WHERE id = ?`
  ).run(
    c.name,
    c.world,
    c.vocation,
    c.level,
    c.residence,
    c.guild?.name || null,
    c.account_status ?? null,
    c.sex ?? null,
    now,
    id
  )
  if (prev?.level !== c.level) {
    db.prepare('INSERT INTO level_history (character_id, level, recorded_at) VALUES (?, ?, ?)').run(
      id,
      c.level,
      now
    )
  }
}

// Outfit a character gets when picking the vocation (TibiaWiki file names).
const OUTFIT: Record<VocationGroup | 'none', string> = {
  knight: 'Knight',
  paladin: 'Hunter',
  sorcerer: 'Mage',
  druid: 'Druid',
  monk: 'Monk',
  none: 'Citizen'
}

// Asks the wiki API for the image URL; a failure only leaves the portrait without an outfit.
async function updateOutfit(id: number): Promise<void> {
  const c = getCharacter(id)
  if (!c) return
  const file = `File:Outfit_${OUTFIT[vocationGroup(c.vocation) ?? 'none']}_${c.sex === 'female' ? 'Female' : 'Male'}.gif`
  try {
    const url = `https://tibia.fandom.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(file)}`
    const res = await fetch(url, { headers: { 'User-Agent': 'DungeonGuideAI/0.1 (Tibia companion app prototype)' } })
    const body = (await res.json()) as { query?: { pages?: Record<string, { imageinfo?: { url: string }[] }> } }
    const imageUrl = Object.values(body.query?.pages ?? {})[0]?.imageinfo?.[0]?.url
    if (imageUrl) getDb().prepare('UPDATE characters SET outfit_url = ? WHERE id = ?').run(imageUrl, id)
  } catch {
    // No network or wiki down: keep the previous outfit.
  }
}

export async function addCharacter(name: string): Promise<Character> {
  const data = await fetchTibiaData(name.trim())
  const db = getDb()
  const existing = db.prepare('SELECT id FROM characters WHERE name = ?').get(data.name) as
    | { id: number }
    | undefined
  const id =
    existing?.id ??
    Number(db.prepare('INSERT INTO characters (name) VALUES (?)').run(data.name).lastInsertRowid)
  applySync(id, data)
  await updateOutfit(id)
  return getCharacter(id)!
}

export async function syncCharacter(id: number): Promise<Character> {
  const current = getCharacter(id)
  if (!current) throw new Error('Personagem não encontrado')
  applySync(id, await fetchTibiaData(current.name))
  await updateOutfit(id)
  return getCharacter(id)!
}

export function removeCharacter(id: number): void {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id)
}

// null goes back to the account type reported by Tibia.com.
export function setPremiumOverride(id: number, premium: boolean | null): void {
  getDb()
    .prepare('UPDATE characters SET premium_override = ? WHERE id = ?')
    .run(premium === null ? null : premium ? 1 : 0, id)
}

export function setSkills(id: number, s: CharacterSkills): void {
  // Accepts only plausible values; empty/invalid becomes null (use the typical value).
  const v = (n: number | null): number | null => (n !== null && Number.isFinite(n) && n >= 0 && n <= 200 ? Math.round(n) : null)
  const sets = SKILL_KEYS.map((k) => `${SKILL_COLUMN[k]} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE characters SET ${sets} WHERE id = ?`)
    .run(...SKILL_KEYS.map((k) => v(s[k])), id)
}

// Image uploaded by the player (data URL already downscaled by the UI); null goes back to the wiki outfit.
export function setPortrait(id: number, dataUrl: string | null): void {
  if (dataUrl !== null && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(dataUrl)) {
    throw new Error('Formato de imagem não suportado')
  }
  getDb().prepare('UPDATE characters SET portrait = ? WHERE id = ?').run(dataUrl, id)
}

export function saveNotes(id: number, notes: string): void {
  getDb().prepare('UPDATE characters SET notes = ? WHERE id = ?').run(notes, id)
}

export function levelHistory(id: number): LevelEntry[] {
  return getDb()
    .prepare(
      'SELECT level, recorded_at AS recordedAt FROM level_history WHERE character_id = ? ORDER BY recorded_at'
    )
    .all(id) as LevelEntry[]
}

export function listProgress(characterId: number): ProgressItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM progress WHERE character_id = ? ORDER BY kind, status, title')
    .all(characterId) as ProgressRow[]
  return rows.map(toProgress)
}

export function addProgress(characterId: number, kind: ProgressKind, title: string): ProgressItem {
  const db = getDb()
  const id = db
    .prepare('INSERT INTO progress (character_id, kind, title, updated_at) VALUES (?, ?, ?, ?)')
    .run(characterId, kind, title.trim(), new Date().toISOString()).lastInsertRowid
  return toProgress(db.prepare('SELECT * FROM progress WHERE id = ?').get(id) as ProgressRow)
}

export function setProgressStatus(id: number, status: ProgressStatus): void {
  getDb()
    .prepare('UPDATE progress SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id)
}

export function removeProgress(id: number): void {
  getDb().prepare('DELETE FROM progress WHERE id = ?').run(id)
}

function describeSkills(s: CharacterSkills): string {
  const names: Record<keyof CharacterSkills, string> = {
    magicLevel: 'magic level',
    fist: 'fist',
    club: 'club',
    sword: 'sword',
    axe: 'axe',
    distance: 'distance',
    shielding: 'shielding',
    fishing: 'fishing'
  }
  const parts = SKILL_KEYS.filter((k) => s[k] !== null).map((k) => `${names[k]} ${s[k]}`)
  return `Skills: ${parts.length ? parts.join(', ') : 'não informadas'}`
}

// Character summary used as context for the AI.
export function describeCharacter(id: number): string | null {
  const c = getCharacter(id)
  if (!c) return null
  const items = listProgress(id)
  const fmt = (kind: ProgressKind, label: string): string => {
    const list = items.filter((i) => i.kind === kind)
    if (!list.length) return ''
    return `${label}:\n${list.map((i) => `- [${i.status}] ${i.title}`).join('\n')}\n`
  }
  return [
    `Nome: ${c.name}`,
    `Vocação: ${c.vocation ?? '?'}`,
    `Level: ${c.level ?? '?'}`,
    `Mundo: ${c.world ?? '?'}`,
    `Residência: ${c.residence ?? '?'}`,
    `Conta: ${c.premium === null ? 'desconhecida' : c.premium ? 'Premium' : 'Free'}`,
    describeSkills(c.skills),
    c.guild ? `Guild: ${c.guild}` : '',
    fmt('quest', 'Quests'),
    fmt('access', 'Acessos'),
    fmt('goal', 'Metas'),
    c.notes ? `Anotações do jogador:\n${c.notes}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
