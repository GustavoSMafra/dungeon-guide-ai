// Agrupa as vocações do Tibia (com ou sem promoção) — usado pelo main e pela UI.

export type VocationGroup = 'knight' | 'paladin' | 'sorcerer' | 'druid' | 'monk'

export function vocationGroup(vocation: string | null): VocationGroup | null {
  const v = (vocation ?? '').toLowerCase()
  if (v.includes('knight')) return 'knight'
  if (v.includes('paladin')) return 'paladin'
  if (v.includes('sorcerer')) return 'sorcerer'
  if (v.includes('druid')) return 'druid'
  if (v.includes('monk')) return 'monk'
  return null
}
