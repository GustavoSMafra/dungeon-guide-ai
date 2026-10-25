import type Database from 'better-sqlite3'
import { getDb } from '../db'
import {
  parseCreature,
  parseHunt,
  parseQuest,
  parseQuestList,
  type CreatureData,
  type HuntData,
  type LootItem,
  type QuestData
} from './infobox'
import {
  huntRisk,
  isSafe,
  levelAllows,
  skillLevelBonus,
  PARTY_SIZE,
  recommendedMode,
  vocationGroup,
  type CharacterSkills,
  type CreatureRisk,
  type HuntRisk,
  type PartyMode
} from './risk'
import { pageUrl } from './urls'

// Hunt and creature tables extracted from infoboxes (see infobox.ts). They allow exact
// filters (level, vocation, risk) that semantic search cannot do.

// Called inside the transaction that stores the page.
export function saveStructured(db: Database.Database, pageId: number | bigint, title: string, src: string): void {
  const hunt = parseHunt(title, src)
  if (hunt) {
    db.prepare(
      `INSERT INTO hunts (page_id, name, city, levels, exp, loot, best_loot, creatures)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pageId,
      hunt.name,
      hunt.city,
      JSON.stringify(hunt.levels),
      hunt.exp,
      hunt.loot,
      JSON.stringify(hunt.bestLoot),
      JSON.stringify(hunt.creatures)
    )
  }
  const c = parseCreature(title, src)
  if (c) {
    db.prepare(
      `INSERT INTO creatures (page_id, name, hp, exp, bestiary_class, bestiary_level, occurrence, damage,
                              max_damage, attack_type, is_boss, damage_mods)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pageId,
      c.name,
      c.hp,
      c.exp,
      c.bestiaryClass,
      c.bestiaryLevel,
      c.occurrence,
      c.damage,
      JSON.stringify(c.maxDamage),
      c.attackType,
      c.isBoss ? 1 : 0,
      JSON.stringify(c.damageMods)
    )
  }
  saveQuest(db, pageId, title, src)
}

function saveQuest(db: Database.Database, pageId: number | bigint, title: string, src: string): void {
  if (title === 'Access Quests') {
    db.prepare('DELETE FROM access_quests').run()
    const ins = db.prepare('INSERT OR IGNORE INTO access_quests (name) VALUES (?)')
    for (const name of parseQuestList(src)) ins.run(name)
  }
  const q = parseQuest(title, src)
  if (!q) return
  db.prepare(
    `INSERT INTO quests (page_id, name, aka, level, level_rec, premium, reward, location, dangers, legend, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pageId,
    q.name,
    q.aka,
    q.level,
    q.levelRec,
    q.premium === null ? null : q.premium ? 1 : 0,
    q.reward,
    q.location,
    JSON.stringify(q.dangers),
    q.legend,
    JSON.stringify(q.tags)
  )
}

export function clearStructured(db: Database.Database, pageId: number): void {
  db.prepare('DELETE FROM hunts WHERE page_id = ?').run(pageId)
  db.prepare('DELETE FROM creatures WHERE page_id = ?').run(pageId)
  db.prepare('DELETE FROM quests WHERE page_id = ?').run(pageId)
}

// --- Queries -----------------------------------------------------------------

// Recommended-level key in the hunt infobox (lvlknights, lvlpaladins, lvlmages...).
function huntLevelKey(vocation: string | null): string | null {
  switch (vocationGroup(vocation)) {
    case 'knight':
      return 'knights'
    case 'paladin':
      return 'paladins'
    case 'sorcerer':
    case 'druid':
      return 'mages'
    case 'monk':
      return 'monks'
    default:
      return null
  }
}

interface CreatureRow {
  name: string
  hp: number | null
  exp: number | null
  bestiaryClass: string | null
  bestiaryLevel: string | null
  occurrence: string | null
  damage: string | null
  maxDamage: string
  attackType: string | null
  isBoss: number
  damageMods: string
  loot: string | null
}

const CREATURE_COLUMNS = `name, hp, exp, bestiary_class AS bestiaryClass, bestiary_level AS bestiaryLevel, occurrence,
  damage, max_damage AS maxDamage, attack_type AS attackType, is_boss AS isBoss, damage_mods AS damageMods`

// Lookup by name: API data first (with loot), then the data parsed from wikitext.
function creatureLookup(db: Database.Database): (name: string) => CreatureData | null {
  const fromApi = db.prepare(`SELECT ${CREATURE_COLUMNS}, loot FROM api_creatures WHERE name = ?`)
  const fromWiki = db.prepare(`SELECT ${CREATURE_COLUMNS}, NULL AS loot FROM creatures WHERE name = ?`)
  return (name) => {
    const r = (fromApi.get(name) ?? fromWiki.get(name)) as CreatureRow | undefined
    if (!r) return null
    return {
      ...r,
      maxDamage: JSON.parse(r.maxDamage) as Record<string, number>,
      damageMods: JSON.parse(r.damageMods) as Record<string, number>,
      isBoss: r.isBoss === 1,
      loot: r.loot ? (JSON.parse(r.loot) as LootItem[]) : undefined
    }
  }
}

export interface HuntAdvice extends HuntData {
  // Level the wiki recommends for the vocation.
  level: number
  url: string
  // Smallest party mode where the hunt is at most moderate risk (null = avoid at the current level).
  recommended: PartyMode | null
  // Party mode used for the evaluation: the one the player asked for, or the recommended one.
  evaluatedAs: PartyMode
  risk: HuntRisk
  creatureInfo: { data: CreatureData; risk: CreatureRisk }[]
  // Creatures with no data in the base (left out of the calculation).
  unknownCreatures: string[]
}

// Hunts scored by risk for the character. With `party`, only the safe ones in that mode;
// without `party`, a mix of the best for solo, duo and party, each with its recommendation.
export function adviseHunts(
  vocation: string | null,
  level: number,
  party: PartyMode | null,
  limit = 10,
  skills?: CharacterSkills
): HuntAdvice[] {
  const group = vocationGroup(vocation)
  if (!group) return []
  const db = getDb()
  const key = huntLevelKey(vocation)
  const loadCreature = creatureLookup(db)
  const rows = db
    .prepare('SELECT name, city, levels, exp, loot, best_loot AS bestLoot, creatures FROM hunts')
    .all() as {
    name: string
    city: string | null
    levels: string
    exp: string | null
    loot: string | null
    bestLoot: string
    creatures: string
  }[]

  const advice: HuntAdvice[] = []
  for (const r of rows) {
    const levels = JSON.parse(r.levels) as Record<string, number>
    const values = Object.values(levels)
    const huntLevel = (key ? levels[key] : undefined) ?? (values.length ? Math.min(...values) : null)
    // Parties handle hunts well above their level; below level-40 the exp is not worth it.
    if (huntLevel === null || huntLevel < level - 40 || huntLevel > level + 30) continue

    const creatures = JSON.parse(r.creatures) as string[]
    const known: CreatureData[] = []
    const unknownCreatures: string[] = []
    for (const name of creatures) {
      const data = loadCreature(name)
      if (data && data.hp) known.push(data)
      else unknownCreatures.push(name)
    }
    if (!known.length) continue

    const recommended = recommendedMode(known, group, level, huntLevel, skills)
    const evaluatedAs = party ?? recommended ?? 'grupo'
    const risk = huntRisk(known, group, level, PARTY_SIZE[evaluatedAs], skills)
    advice.push({
      name: r.name,
      city: r.city,
      levels,
      exp: r.exp,
      loot: r.loot,
      bestLoot: JSON.parse(r.bestLoot) as string[],
      creatures,
      level: huntLevel,
      url: pageUrl(r.name),
      recommended,
      evaluatedAs,
      risk,
      creatureInfo: known.map((data, i) => ({ data, risk: risk.creatures[i] })),
      unknownCreatures
    })
  }

  // Closest to the character's level first (hunts far below give little exp).
  const byLevel = (a: HuntAdvice, b: HuntAdvice): number => b.level - a.level

  if (party) {
    return advice
      .filter((h) => isSafe(h.risk) && levelAllows(party, level, h.level, skillLevelBonus(group, level, skills)))
      .sort(byLevel)
      .slice(0, limit)
  }
  const pick = (mode: PartyMode, n: number): HuntAdvice[] =>
    advice.filter((h) => h.recommended === mode).sort(byLevel).slice(0, n)
  const soloCount = Math.ceil(limit / 2)
  const rest = Math.floor((limit - soloCount) / 2)
  return [...pick('solo', soloCount), ...pick('dupla', rest), ...pick('grupo', limit - soloCount - rest)]
}

// --- Quests ------------------------------------------------------------------

export interface QuestAdvice extends QuestData {
  url: string
  isAccess: boolean
  // The player marked it as "in progress" in the character's progress.
  inProgress: boolean
  recommended: PartyMode | null
  // Risk from the creatures in "dangers" (null = the wiki lists no known dangers).
  risk: HuntRisk | null
}

export interface QuestCharacter {
  vocation: string | null
  level: number
  premium: boolean | null
  skills?: CharacterSkills
}

// Weight of what the reward grants, used to rank suggestions.
const TAG_WEIGHT: Record<string, number> = { blessing: 30, magia: 15, outfit: 10, montaria: 10, achievement: 2 }

// "The Inquisition Quest" and "inquisition" must match.
const normalizeQuest = (s: string): string =>
  s.toLowerCase().replace(/\bquest\b|\bthe\b|[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export function adviseQuests(
  character: QuestCharacter,
  progress: { title: string; status: 'todo' | 'doing' | 'done' }[],
  limit = 10,
  laterLimit = 4
): { now: QuestAdvice[]; later: QuestAdvice[] } {
  const db = getDb()
  const group = vocationGroup(character.vocation)
  const access = new Set(
    (db.prepare('SELECT name FROM access_quests').all() as { name: string }[]).map((r) => r.name.toLowerCase())
  )
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => normalizeQuest(p.title)))
  const doing = new Set(progress.filter((p) => p.status === 'doing').map((p) => normalizeQuest(p.title)))
  const loadCreature = creatureLookup(db)
  const rows = db
    .prepare(
      `SELECT name, aka, level, level_rec AS levelRec, premium, reward, location, dangers, legend, tags FROM quests`
    )
    .all() as (Omit<QuestData, 'premium' | 'dangers' | 'tags'> & { premium: number | null; dangers: string; tags: string })[]

  const level = character.level
  const all: (QuestAdvice & { score: number })[] = []
  for (const r of rows) {
    // World changes and events are recurring, not quests a character "has".
    if (/world change|\bevent\b/i.test(`${r.name} ${r.aka ?? ''}`) || r.name === 'The Lightbearer') continue
    const key = normalizeQuest(r.name)
    if (done.has(key) || (r.aka && done.has(normalizeQuest(r.aka)))) continue
    const premium = r.premium === null ? null : r.premium === 1
    // Free accounts cannot do premium quests.
    if (character.premium === false && premium === true) continue

    const dangers = JSON.parse(r.dangers) as string[]
    const tags = JSON.parse(r.tags) as string[]
    const isAccess = access.has(r.name.toLowerCase())
    const known = dangers
      .map((name) => loadCreature(name))
      .filter((c): c is CreatureData => Boolean(c?.hp))
    const targetLevel = r.levelRec ?? r.level ?? level
    const risk = group && known.length ? huntRisk(known, group, level, PARTY_SIZE.solo, character.skills) : null
    const recommended =
      group && known.length ? recommendedMode(known, group, level, targetLevel, character.skills) : null
    const score =
      (isAccess ? 100 : 0) +
      tags.reduce((s, t) => s + (TAG_WEIGHT[t] ?? 0), 0) -
      Math.abs(targetLevel - level) / 5 -
      // No level at all on the wiki usually means an incomplete page.
      (r.level === null && r.levelRec === null ? 5 : 0)
    all.push({
      ...r,
      premium,
      dangers,
      tags: isAccess && !tags.includes('acesso') ? ['acesso', ...tags] : tags,
      url: pageUrl(r.name),
      isAccess,
      inProgress: doing.has(key),
      recommended,
      risk,
      score
    })
  }

  // Now: minimum level reached and recommended level at most 30 above. Later: access quests
  // still out of reach, nearest first.
  const reachable = (q: QuestAdvice): boolean =>
    (q.level ?? 0) <= level && (q.levelRec ?? q.level ?? level) <= level + 30
  const now = all.filter(reachable).sort((a, b) => b.score - a.score).slice(0, limit)
  const later = all
    .filter((q) => q.isAccess && !reachable(q))
    .sort((a, b) => (a.levelRec ?? a.level ?? 0) - (b.levelRec ?? b.level ?? 0))
    .slice(0, laterLimit)
  return { now, later }
}

export function structuredStats(): { hunts: number; creatures: number; quests: number } {
  const db = getDb()
  const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  return {
    hunts: count('hunts'),
    creatures: count('(SELECT name FROM creatures UNION SELECT name FROM api_creatures)'),
    quests: count('quests')
  }
}
