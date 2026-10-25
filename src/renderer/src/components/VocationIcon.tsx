import type { ReactElement } from 'react'
import { type VocationGroup, vocationGroup } from '../../../shared/vocation'

// Ícones desenhados em SVG (viewBox 24x24); a cor vem do CSS via currentColor.
const ICONS: Record<VocationGroup | 'none', ReactElement> = {
  // Espada
  knight: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
    </g>
  ),
  // Arco e flecha
  paladin: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11Q17 7 13 21" strokeWidth="2.2" />
      <path d="M3 11 13 21" strokeWidth="1" />
      <path d="M4 20 19 5" />
      <path d="M19 5h-5M19 5v5" />
      <path d="M4 20v-3M4 20h3" />
    </g>
  ),
  // Chama
  sorcerer: (
    <g>
      <path
        fill="currentColor"
        d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-4 3-5 3-8 1 2 2 3 3 3 0-2-1-5 0-7Z"
      />
      <path fill="#ffd27a" d="M12 12c.6 2 3 3 3 5.5a3 3 0 0 1-6 0c0-2 1.5-2.5 1.5-4 .5 1 1 1.3 1.5 1.3 0-1-.3-2 0-2.8Z" />
    </g>
  ),
  // Folha
  druid: (
    <g>
      <path fill="currentColor" d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15Z" />
      <path fill="none" stroke="#1e1813" strokeWidth="1.2" strokeLinecap="round" d="M5 19 15 9M10 14h4M10 14v-4" />
    </g>
  ),
  // Punho
  monk: (
    <g fill="currentColor" stroke="#1e1813" strokeWidth="0.8">
      <rect x="6.5" y="5" width="3.4" height="7" rx="1.7" />
      <rect x="9.8" y="4.5" width="3.4" height="7.5" rx="1.7" />
      <rect x="13.1" y="5" width="3.4" height="7" rx="1.7" />
      <rect x="16.4" y="6" width="3.2" height="6" rx="1.6" />
      <path d="M6.5 10.5h13V15a5.5 5.5 0 0 1-5.5 5.5h-3A4.5 4.5 0 0 1 6.5 16Z" />
      <rect x="4" y="11" width="8" height="3.4" rx="1.7" />
    </g>
  ),
  // Sem vocação: escudo vazio
  none: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      d="M12 3 19 6v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6Z"
    />
  )
}

export default function VocationIcon({ vocation }: { vocation: string | null }) {
  const group = vocationGroup(vocation) ?? 'none'
  return (
    <span className={`voc-icon voc-${group}`} title={vocation ?? 'Sem vocação'}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {ICONS[group]}
      </svg>
    </span>
  )
}
