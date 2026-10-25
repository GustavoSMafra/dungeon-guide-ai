// Risk estimate of a creature/hunt for a character.
//
// HP and mana use Tibia's official formulas. Damage per second, healing per second and mitigation
// are hand-calibrated ESTIMATES (see the constants below); they are meant to compare creatures
// with each other, not to predict an exact fight.

import type { CharacterSkills } from '../../shared/types'
import { type VocationGroup, vocationGroup } from '../../shared/vocation'

export type { CharacterSkills, VocationGroup }
export { vocationGroup }
export type PartyMode = 'solo' | 'dupla' | 'grupo'
export type RiskLabel = 'baixo' | 'moderado' | 'alto' | 'muito alto'

export const PARTY_SIZE: Record<PartyMode, number> = { solo: 1, dupla: 2, grupo: 4 }

interface VocationProfile {
  hpPerLevel: number
  manaPerLevel: number
  // Fraction of physical damage that gets through defense (armor, shield, shielding).
  physicalTaken: number
  // Fraction of elemental damage that gets through (without a specific protection set).
  elementalTaken: number
  // Single-target damage per second ≈ a * level + b.
  dps: [number, number]
  // Sustainable healing per second ≈ factor * level (potions + spells).
  healPerLevel: number
  // Elements the vocation can use to exploit weaknesses.
  elements: string[]
  // Attacks from range: can avoid part of the damage from melee-only creatures.
  ranged: boolean
  magicShield: boolean
}

const PROFILES: Record<VocationGroup, VocationProfile> = {
  knight: {
    hpPerLevel: 15, manaPerLevel: 5, physicalTaken: 0.55, elementalTaken: 0.9,
    dps: [1.3, 20], healPerLevel: 2.0, elements: ['physical'], ranged: false, magicShield: false
  },
  paladin: {
    hpPerLevel: 10, manaPerLevel: 15, physicalTaken: 0.8, elementalTaken: 1,
    dps: [1.6, 20], healPerLevel: 1.5, elements: ['physical', 'holy'], ranged: true, magicShield: false
  },
  sorcerer: {
    hpPerLevel: 5, manaPerLevel: 30, physicalTaken: 0.95, elementalTaken: 1,
    dps: [1.5, 20], healPerLevel: 1.2, elements: ['fire', 'energy', 'death'], ranged: true, magicShield: true
  },
  druid: {
    hpPerLevel: 5, manaPerLevel: 30, physicalTaken: 0.95, elementalTaken: 1,
    dps: [1.3, 20], healPerLevel: 1.4, elements: ['ice', 'earth'], ranged: true, magicShield: true
  },
  // Monk is the newest vocation; values are approximate.
  monk: {
    hpPerLevel: 10, manaPerLevel: 10, physicalTaken: 0.7, elementalTaken: 0.95,
    dps: [1.4, 20], healPerLevel: 1.6, elements: ['physical'], ranged: false, magicShield: false
  }
}

// Ranged vocations kite melee creatures and take only part of their physical damage.
const KITING_PHYSICAL = 0.4
// Average damage per second as a fraction of the max hit (one turn every ~2s, not every turn is a max hit).
const AVG_INCOMING = 0.25
// Fraction of effective health a single hit can take without much concern.
const BURST_COMFORT = 0.4

// Typical skill for the level ≈ a + b * ln(level). Hand-calibrated ESTIMATE based on
// common characters (e.g. EK 100 with melee ~89, mage 100 with ML ~68). null = not applicable.
type Curve = [number, number]
const TYPICAL_SKILLS: Record<VocationGroup, { offense: Curve; shielding: Curve | null; magic: Curve }> = {
  knight: { offense: [-36.8, 27.3], shielding: [-41.8, 27.3], magic: [-9.9, 4.3] },
  paladin: { offense: [-23.8, 25.25], shielding: [-30, 21], magic: [-28, 11.5] },
  sorcerer: { offense: [-82, 32.5], shielding: null, magic: [-82, 32.5] },
  druid: { offense: [-82, 32.5], shielding: null, magic: [-82, 32.5] },
  monk: { offense: [-36.8, 27.3], shielding: null, magic: [-20, 9] }
}

const curve = ([a, b]: Curve, level: number): number => Math.max(10, Math.round(a + b * Math.log(level)))
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export function typicalSkills(group: VocationGroup, level: number): { offense: number; shielding: number | null; magicLevel: number } {
  const t = TYPICAL_SKILLS[group]
  return {
    offense: curve(t.offense, level),
    shielding: t.shielding ? curve(t.shielding, level) : null,
    magicLevel: curve(t.magic, level)
  }
}

// Skill that drives each vocation's damage.
export function offensiveSkill(group: VocationGroup, skills: CharacterSkills | undefined): number | null {
  if (!skills) return null
  if (group === 'monk') return skills.fist
  if (group === 'knight') {
    // Knights train a single weapon: the highest of the three entered counts.
    const melee = [skills.club, skills.sword, skills.axe].filter((n): n is number => n !== null)
    return melee.length ? Math.max(...melee) : null
  }
  if (group === 'paladin') return skills.distance
  return skills.magicLevel
}

export interface CharacterStats {
  hp: number
  mana: number
  // Effective health: HP + magic shield capacity for mages.
  pool: number
  dps: number
  healPerSecond: number
  // Fraction of physical damage that gets through defense, adjusted for shielding.
  physicalTaken: number
  // Attack skill used and the level's typical value, to explain the result.
  offense: { skill: number; typical: number; informed: boolean }
}

export function characterStats(group: VocationGroup, level: number, skills?: CharacterSkills): CharacterStats {
  const p = PROFILES[group]
  const lv = Math.max(level, 8)
  const typical = typicalSkills(group, lv)
  const hp = 185 + (lv - 8) * p.hpPerLevel
  const mana = 90 + (lv - 8) * p.manaPerLevel

  // Utamo vita absorbs 300 + 7.6 * level + 7 * magic level.
  const magicLevel = skills?.magicLevel ?? typical.magicLevel
  const shield = p.magicShield ? 300 + 7.6 * lv + 7 * magicLevel : 0

  // Damage scales with the attack skill relative to the level's typical value. The +20 dampens the effect,
  // because part of the damage (spells, potions) depends on level, not skill.
  const informedOffense = offensiveSkill(group, skills)
  const offense = informedOffense ?? typical.offense
  const dpsFactor = clamp((offense + 20) / (typical.offense + 20), 0.5, 1.8)

  // Shielding above typical blocks more physical damage; below it, less.
  const shieldFactor =
    typical.shielding !== null && skills?.shielding != null
      ? clamp((typical.shielding + 50) / (skills.shielding + 50), 0.75, 1.3)
      : 1

  return {
    hp,
    mana,
    pool: hp + shield,
    dps: (p.dps[0] * lv + p.dps[1]) * dpsFactor,
    healPerSecond: p.healPerLevel * lv,
    physicalTaken: p.physicalTaken * shieldFactor,
    offense: { skill: offense, typical: typical.offense, informed: informedOffense !== null }
  }
}

export interface CreatureCombat {
  name: string
  hp: number | null
  exp: number | null
  maxDamage: Record<string, number>
  attackType: string | null
  isBoss: boolean
  damageMods: Record<string, number>
}

export interface CreatureRisk {
  name: string
  score: number
  label: RiskLabel
  // Estimated max hit as a % of effective health.
  burstPct: number
  // Estimated time to kill (seconds) with the given party.
  killSeconds: number | null
  // No max damage data on the wiki: rough estimate from exp.
  estimated: boolean
}

export function riskLabel(score: number): RiskLabel {
  if (score < 0.3) return 'baixo'
  if (score < 0.55) return 'moderado'
  if (score < 0.85) return 'alto'
  return 'muito alto'
}

// Max hit in one turn: physical + the largest non-physical attack (creatures can melee and
// cast in the same turn). Mana drain and summons are left out.
function burstDamage(
  c: CreatureCombat,
  p: VocationProfile,
  physicalTaken: number
): { burst: number; estimated: boolean } {
  const md = c.maxDamage
  const kiting = p.ranged && /melee/i.test(c.attackType ?? '') && !/distance/i.test(c.attackType ?? '')
  const physFactor = physicalTaken * (kiting ? KITING_PHYSICAL : 1)
  const others = Object.entries(md)
    .filter(([k]) => !['physical', 'manadrain', 'summons', 'total'].includes(k))
    .map(([, v]) => v)
  if (md.physical !== undefined || others.length) {
    const burst = (md.physical ?? 0) * physFactor + Math.max(0, ...others) * p.elementalTaken
    return { burst, estimated: false }
  }
  if (md.total) {
    // Only the total: assume half physical, half elemental.
    return { burst: md.total * (0.5 * physFactor + 0.5 * p.elementalTaken), estimated: false }
  }
  // No data at all: creatures usually hit for roughly half the exp they give.
  return { burst: (c.exp ?? 0) * 0.5, estimated: true }
}

export function creatureRisk(
  c: CreatureCombat,
  group: VocationGroup,
  level: number,
  partySize = 1,
  skills?: CharacterSkills
): CreatureRisk {
  const p = PROFILES[group]
  const stats = characterStats(group, level, skills)
  const { burst, estimated } = burstDamage(c, p, stats.physicalTaken)

  // In a party, blocker + healer soften the hit; damage and healing add up.
  const support = 1 + 0.25 * (partySize - 1)
  const effectiveBurst = burst / support
  const heal = stats.healPerSecond * (1 + 0.5 * (partySize - 1))

  // Best damage modifier the vocation can exploit (100 = normal).
  const bestMod = Math.max(...p.elements.map((e) => c.damageMods[e] ?? 100)) / 100
  const dps = stats.dps * partySize * Math.max(bestMod, 0.1)
  const killSeconds = c.hp ? c.hp / dps : null

  const burstRatio = effectiveBurst / stats.pool
  const netIncoming = Math.max(0, effectiveBurst * AVG_INCOMING - heal)
  const sustainRatio = killSeconds ? (netIncoming * killSeconds) / stats.pool : 0
  // Hits above ~40% of effective health weigh more: two unlucky hits in a row kill.
  const score = burstRatio + 1.5 * Math.max(0, burstRatio - BURST_COMFORT) + 0.5 * Math.min(sustainRatio, 2)

  return {
    name: c.name,
    score,
    label: riskLabel(score),
    burstPct: Math.round(burstRatio * 100),
    killSeconds: killSeconds === null ? null : Math.round(killSeconds),
    estimated
  }
}

export interface HuntRisk {
  // "Typical" hunt risk: 75th percentile of its creatures (one rare creature does not dominate the hunt).
  score: number
  label: RiskLabel
  // Creatures with very high risk even in the evaluated mode: avoid or be careful.
  dangerous: CreatureRisk[]
  creatures: CreatureRisk[]
}

export function huntRisk(
  creatures: CreatureCombat[],
  group: VocationGroup,
  level: number,
  partySize: number,
  skills?: CharacterSkills
): HuntRisk {
  const risks = creatures.map((c) => creatureRisk(c, group, level, partySize, skills))
  const sorted = risks.map((r) => r.score).sort((a, b) => a - b)
  const score = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))] : 0
  return {
    score,
    label: riskLabel(score),
    dangerous: risks.filter((r) => r.label === 'muito alto').sort((a, b) => b.score - a.score),
    creatures: risks
  }
}

const SAFE_SCORE = 0.55

// The per-creature model ignores several creatures attacking at once; the wiki's recommended
// level captures that. How far below it the character may be in each party mode:
const MAX_LEVEL_GAP: Record<PartyMode, number> = { solo: 5, dupla: 15, grupo: 30 }

// Skills above typical make up for some level: ~1 level of slack for every 3 points of attack
// skill above typical (up to +10); below typical, the slack shrinks (down to -5).
export function skillLevelBonus(group: VocationGroup, level: number, skills?: CharacterSkills): number {
  const { offense } = characterStats(group, level, skills)
  if (!offense.informed) return 0
  return clamp(Math.round((offense.skill - offense.typical) / 3), -5, 10)
}

export function levelAllows(mode: PartyMode, characterLevel: number, huntLevel: number, bonus = 0): boolean {
  return huntLevel - characterLevel <= MAX_LEVEL_GAP[mode] + bonus
}

// Smallest party mode where the hunt is at most moderate risk and within the level slack;
// null = avoid.
export function recommendedMode(
  creatures: CreatureCombat[],
  group: VocationGroup,
  level: number,
  huntLevel: number,
  skills?: CharacterSkills
): PartyMode | null {
  const bonus = skillLevelBonus(group, level, skills)
  for (const mode of ['solo', 'dupla', 'grupo'] as PartyMode[]) {
    if (!levelAllows(mode, level, huntLevel, bonus)) continue
    if (huntRisk(creatures, group, level, PARTY_SIZE[mode], skills).score < SAFE_SCORE) return mode
  }
  return null
}

// How the vocation deals damage, so the model does not tell a knight to "use fire".
export const VOCATION_DAMAGE: Record<VocationGroup, string> = {
  knight: 'ataca com dano físico (fraquezas elementais só importam com armas encantadas/imbuements)',
  paladin: 'ataca com dano físico à distância e holy (Divine Missile/Caldera)',
  sorcerer: 'ataca com fire, energy e death',
  druid: 'ataca com ice e earth',
  monk: 'ataca com dano físico'
}

export function isSafe(risk: HuntRisk): boolean {
  return risk.score < SAFE_SCORE
}

// Detects in the message whether the player goes solo, as a duo or in a party.
export function partyModeFromText(text: string): PartyMode | null {
  const t = text.toLowerCase()
  if (/\b(sozinh[oa]|solo|solando|solar)\b/.test(t)) return 'solo'
  if (/\b(dupla|duo|em dois|em 2|com (um|1) amig[oa])\b/.test(t)) return 'dupla'
  if (/\b(grupo|party|time|equipe|pt|trio|em tr[eê]s|em 3|team ?hunt)\b/.test(t)) return 'grupo'
  return null
}
