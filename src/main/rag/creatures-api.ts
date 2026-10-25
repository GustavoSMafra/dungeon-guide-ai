import { getDb } from '../db'
import { creature, type ApiCreature } from '../tibiadata'
import { parseMaxDamage, type CreatureData, type LootItem } from './infobox'
import { summarizeDamageMods } from './wikitext'

// Creature data from the TibiaData API, already structured (including loot). It takes precedence
// over the data parsed from wikitext (creatures table), which stays as a fallback if the API is down.

const CONCURRENCY = 6

// API field → element used in damageMods (same keys as the wiki infobox).
const MOD_FIELDS: Record<string, string> = {
  physicalDamageModifier: 'physical',
  earthDamageModifier: 'earth',
  fireDamageModifier: 'fire',
  deathDamageModifier: 'death',
  energyDamageModifier: 'energy',
  holyDamageModifier: 'holy',
  iceDamageModifier: 'ice',
  lifeDrainDamageModifier: 'hpdrain',
  drownDamageModifier: 'drown'
}

const capitalize = (s: string | null): string | null => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function creatureFromApi(c: ApiCreature): CreatureData {
  const box = c.structuredData?.infobox ?? {}
  const get = (k: string): string | null => {
    const v = box[k]?.trim()
    return v && v !== '--' ? v : null
  }
  const damageMods: Record<string, number> = {}
  for (const [field, element] of Object.entries(MOD_FIELDS)) {
    const pct = parseFloat(get(field) ?? '')
    if (!Number.isNaN(pct)) damageMods[element] = pct
  }
  const damage = summarizeDamageMods(Object.entries(damageMods).map(([el, pct]) => [`${el}DmgMod`, `${pct}%`]))
    .slice(1)
    .join('; ')
  return {
    name: c.name,
    // The API uses 0 when the wiki has no value.
    hp: c.hitpoints || null,
    exp: c.experience || null,
    // The API uses lowercase ("medium"); the wiki and the prompt use "Medium".
    bestiaryClass: capitalize(get('bestiaryClass')),
    bestiaryLevel: capitalize(get('bestiaryDifficulty')),
    occurrence: capitalize(get('bestiaryOccurrence')),
    damage: damage || null,
    maxDamage: parseMaxDamage(get('maxDamage') ?? undefined),
    attackType: get('attackType'),
    isBoss: /^yes/i.test(get('isBoss') ?? ''),
    damageMods,
    loot: (c.lootStatistics ?? []).map((l) => ({ item: l.itemName, rarity: l.rarity }))
  }
}

function save(c: CreatureData): void {
  getDb()
    .prepare(
      `INSERT INTO api_creatures (name, hp, exp, bestiary_class, bestiary_level, occurrence, damage, max_damage,
                                  attack_type, is_boss, damage_mods, loot, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         hp = excluded.hp, exp = excluded.exp, bestiary_class = excluded.bestiary_class,
         bestiary_level = excluded.bestiary_level, occurrence = excluded.occurrence, damage = excluded.damage,
         max_damage = excluded.max_damage, attack_type = excluded.attack_type, is_boss = excluded.is_boss,
         damage_mods = excluded.damage_mods, loot = excluded.loot, fetched_at = excluded.fetched_at`
    )
    .run(
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
      JSON.stringify(c.damageMods),
      JSON.stringify(c.loot ?? []),
      new Date().toISOString()
    )
}

// Creatures the app uses: those with an indexed page and those referenced by hunts and quests.
export function relevantCreatureNames(): string[] {
  const db = getDb()
  const names = new Set<string>()
  for (const r of db.prepare('SELECT name FROM creatures').all() as { name: string }[]) names.add(r.name)
  const lists = [
    ...(db.prepare('SELECT creatures AS list FROM hunts').all() as { list: string }[]),
    ...(db.prepare('SELECT dangers AS list FROM quests').all() as { list: string }[])
  ]
  for (const r of lists) for (const n of JSON.parse(r.list) as string[]) names.add(n)
  return [...names]
}

// Downloads and stores the creatures, a few in parallel. Names the API does not know (404) are
// skipped; if the whole API fails, the first error is thrown.
export async function syncCreatures(
  names: string[],
  onProgress?: (done: number, total: number) => void
): Promise<{ saved: number; failed: number }> {
  let next = 0
  let done = 0
  let saved = 0
  let failed = 0
  let firstError: Error | null = null
  const worker = async (): Promise<void> => {
    while (next < names.length) {
      const name = names[next++]
      try {
        save(creatureFromApi(await creature(name)))
        saved++
      } catch (err) {
        failed++
        firstError ??= err as Error
      }
      onProgress?.(++done, names.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker))
  if (names.length && !saved && firstError) throw firstError
  return { saved, failed }
}
