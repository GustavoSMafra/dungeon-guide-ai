// Estimativa de risco de uma criatura/hunt para um personagem.
//
// HP e mana usam as fórmulas oficiais do Tibia. Dano por segundo, cura por segundo e mitigação
// são ESTIMATIVAS calibradas à mão (ver as constantes abaixo); servem para comparar criaturas
// entre si, não para prever uma luta exata.

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
  // Fração do dano físico que passa pela defesa (armadura, escudo, shielding).
  physicalTaken: number
  // Fração do dano elemental que passa (sem set de proteção específico).
  elementalTaken: number
  // Dano em alvo único por segundo ≈ a * level + b.
  dps: [number, number]
  // Cura sustentável por segundo ≈ fator * level (poções + magias).
  healPerLevel: number
  // Elementos que a vocação consegue usar para explorar fraquezas.
  elements: string[]
  // Ataca à distância: consegue evitar parte do dano de criaturas só melee.
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
  // Monk é a vocação mais nova; valores aproximados.
  monk: {
    hpPerLevel: 10, manaPerLevel: 10, physicalTaken: 0.7, elementalTaken: 0.95,
    dps: [1.4, 20], healPerLevel: 1.6, elements: ['physical'], ranged: false, magicShield: false
  }
}

// Vocações de distância "kitam" criaturas melee e recebem só parte do dano físico delas.
const KITING_PHYSICAL = 0.4
// Dano médio por segundo como fração do golpe máximo (um turno a cada ~2s, nem todo turno é máximo).
const AVG_INCOMING = 0.25
// Fração da vida efetiva que um golpe pode tirar sem preocupar muito.
const BURST_COMFORT = 0.4

// Skill típica para o level ≈ a + b * ln(level). ESTIMATIVA calibrada à mão a partir de
// personagens comuns (ex.: EK 100 com melee ~89, mago 100 com ML ~68). null = não se aplica.
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

// Skill que define o dano de cada vocação.
export function offensiveSkill(group: VocationGroup, skills: CharacterSkills | undefined): number | null {
  if (!skills) return null
  if (group === 'monk') return skills.fist
  if (group === 'knight') {
    // O knight treina uma arma só: vale a maior das três informadas.
    const melee = [skills.club, skills.sword, skills.axe].filter((n): n is number => n !== null)
    return melee.length ? Math.max(...melee) : null
  }
  if (group === 'paladin') return skills.distance
  return skills.magicLevel
}

export interface CharacterStats {
  hp: number
  mana: number
  // Vida efetiva: HP + capacidade do magic shield para magos.
  pool: number
  dps: number
  healPerSecond: number
  // Fração do dano físico que passa pela defesa, já ajustada pelo shielding.
  physicalTaken: number
  // Skill de ataque usada e a típica do level, para explicar o resultado.
  offense: { skill: number; typical: number; informed: boolean }
}

export function characterStats(group: VocationGroup, level: number, skills?: CharacterSkills): CharacterStats {
  const p = PROFILES[group]
  const lv = Math.max(level, 8)
  const typical = typicalSkills(group, lv)
  const hp = 185 + (lv - 8) * p.hpPerLevel
  const mana = 90 + (lv - 8) * p.manaPerLevel

  // Utamo vita absorve 300 + 7.6 * level + 7 * magic level.
  const magicLevel = skills?.magicLevel ?? typical.magicLevel
  const shield = p.magicShield ? 300 + 7.6 * lv + 7 * magicLevel : 0

  // Dano escala com a skill de ataque relativa à típica do level. O +20 amortece o efeito,
  // porque parte do dano (magias, poções) depende do level e não da skill.
  const informedOffense = offensiveSkill(group, skills)
  const offense = informedOffense ?? typical.offense
  const dpsFactor = clamp((offense + 20) / (typical.offense + 20), 0.5, 1.8)

  // Shielding acima do típico bloqueia mais dano físico; abaixo, menos.
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
  // Golpe máximo estimado como % da vida efetiva.
  burstPct: number
  // Tempo estimado para matar (segundos) com o grupo informado.
  killSeconds: number | null
  // Sem dados de dano máximo na wiki: estimativa grosseira pelo exp.
  estimated: boolean
}

export function riskLabel(score: number): RiskLabel {
  if (score < 0.3) return 'baixo'
  if (score < 0.55) return 'moderado'
  if (score < 0.85) return 'alto'
  return 'muito alto'
}

// Golpe máximo num turno: físico + o maior ataque não físico (criaturas podem bater e
// lançar magia no mesmo turno). Mana drain e summons ficam de fora.
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
    // Só o total: supõe metade física, metade elemental.
    return { burst: md.total * (0.5 * physFactor + 0.5 * p.elementalTaken), estimated: false }
  }
  // Sem dado nenhum: criaturas costumam bater algo em torno de metade do exp que dão.
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

  // Em grupo, bloqueador + curandeiro aliviam o golpe; o dano e a cura se somam.
  const support = 1 + 0.25 * (partySize - 1)
  const effectiveBurst = burst / support
  const heal = stats.healPerSecond * (1 + 0.5 * (partySize - 1))

  // Melhor modificador de dano que a vocação consegue explorar (100 = normal).
  const bestMod = Math.max(...p.elements.map((e) => c.damageMods[e] ?? 100)) / 100
  const dps = stats.dps * partySize * Math.max(bestMod, 0.1)
  const killSeconds = c.hp ? c.hp / dps : null

  const burstRatio = effectiveBurst / stats.pool
  const netIncoming = Math.max(0, effectiveBurst * AVG_INCOMING - heal)
  const sustainRatio = killSeconds ? (netIncoming * killSeconds) / stats.pool : 0
  // Golpes acima de ~40% da vida efetiva pesam mais: um azar com dois golpes seguidos mata.
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
  // Risco "típico" da hunt: percentil 75 das criaturas (uma criatura rara não domina a hunt).
  score: number
  label: RiskLabel
  // Criaturas de risco muito alto mesmo no modo avaliado: evitar ou ter cuidado.
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

// O cálculo por criatura não modela várias criaturas atacando juntas; o level recomendado pela
// wiki captura isso. Quanto o personagem pode estar abaixo dele em cada formação:
const MAX_LEVEL_GAP: Record<PartyMode, number> = { solo: 5, dupla: 15, grupo: 30 }

// Skills acima do típico compensam parte do level: ~1 level de folga a cada 3 pontos de skill
// de ataque acima do típico (até +10); abaixo do típico, a folga diminui (até -5).
export function skillLevelBonus(group: VocationGroup, level: number, skills?: CharacterSkills): number {
  const { offense } = characterStats(group, level, skills)
  if (!offense.informed) return 0
  return clamp(Math.round((offense.skill - offense.typical) / 3), -5, 10)
}

export function levelAllows(mode: PartyMode, characterLevel: number, huntLevel: number, bonus = 0): boolean {
  return huntLevel - characterLevel <= MAX_LEVEL_GAP[mode] + bonus
}

// Menor formação em que a hunt fica com risco no máximo moderado e dentro da folga de level;
// null = evitar.
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

// Como a vocação causa dano, para o modelo não sugerir "use fire" a um knight.
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

// Detecta na mensagem se o jogador vai sozinho, em dupla ou em grupo.
export function partyModeFromText(text: string): PartyMode | null {
  const t = text.toLowerCase()
  if (/\b(sozinh[oa]|solo|solando|solar)\b/.test(t)) return 'solo'
  if (/\b(dupla|duo|em dois|em 2|com (um|1) amig[oa])\b/.test(t)) return 'dupla'
  if (/\b(grupo|party|time|equipe|pt|trio|em tr[eê]s|em 3|team ?hunt)\b/.test(t)) return 'grupo'
  return null
}
