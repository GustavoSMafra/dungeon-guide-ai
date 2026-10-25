import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SKILL_KEYS, type Character, type CharacterSkills, type ProgressItem } from '../../../shared/types'
import VocationIcon from './VocationIcon'

const SKILL_LABEL: Record<keyof CharacterSkills, string> = {
  magicLevel: 'Magic Level',
  fist: 'Fist',
  club: 'Club',
  sword: 'Sword',
  axe: 'Axe',
  distance: 'Distance',
  shielding: 'Shielding',
  fishing: 'Fishing'
}

const WEAPONS: (keyof CharacterSkills)[] = ['club', 'sword', 'axe']

interface Props {
  characters: Character[]
  active: Character | null
  onSelect: (id: number | null) => void
  onAdd: () => void
}

// Ficha à direita do Guia. O nome do personagem abre a lista para trocar o ativo.
export default function PlayerSheet({ characters, active, onSelect, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [doing, setDoing] = useState<ProgressItem[]>([])
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) {
      setDoing([])
      return
    }
    let alive = true
    void window.api.characters.progress(active.id).then((items) => {
      if (alive) setDoing(items.filter((p) => p.status === 'doing'))
    })
    return () => {
      alive = false
    }
  }, [active])

  // Fecha a lista ao clicar fora dela.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') setOpen(false)
  }

  const pick = (id: number | null): void => {
    onSelect(id)
    setOpen(false)
  }

  // Só as skills que importam para a vocação (o típico vem null nas demais). Knights usam uma
  // arma só: das três, aparecem as preenchidas; sem nenhuma, uma linha "Arma".
  const relevant = active ? SKILL_KEYS.filter((k) => k !== 'fishing' && active.typicalSkills[k] !== null) : []
  const weapons = relevant.filter((k) => WEAPONS.includes(k))
  const informedWeapons = weapons.filter((k) => active?.skills[k] !== null)
  const showWeaponPlaceholder = weapons.length > 1 && !informedWeapons.length
  const skills = weapons.length > 1 ? relevant.filter((k) => !WEAPONS.includes(k) || informedWeapons.includes(k)) : relevant
  const portrait = active ? (active.portrait ?? active.outfitUrl) : null
  const account = active?.premium === null ? null : active?.premium ? 'Premium' : 'Free'

  return (
    <aside className="player-sheet" aria-label="Ficha do jogador">
      <div className="ps-title">
        <span>Ficha do Jogador</span>
      </div>

      <div className="ps-identity" ref={root} onKeyDown={onKey}>
        <div className="ps-portrait">
          {portrait ? <img src={portrait} alt="" /> : <VocationIcon vocation={active?.vocation ?? null} />}
        </div>
        {characters.length ? (
          <button
            type="button"
            className="ps-switch"
            aria-haspopup="listbox"
            aria-expanded={open}
            title="Trocar personagem"
            onClick={() => setOpen((o) => !o)}
          >
            {active?.name ?? 'Nenhum personagem'}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <strong className="ps-switch ps-empty">Nenhum personagem</strong>
        )}
        {active && (
          <span className="ps-info">
            {[active.vocation, active.world, account].filter(Boolean).join(' · ')}
          </span>
        )}

        {open && (
          <div className="ps-menu" role="listbox" aria-label="Personagens">
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === active?.id}
                className={c.id === active?.id ? 'selected' : ''}
                onClick={() => pick(c.id)}
              >
                <strong>{c.name}</strong>
                <small>
                  {c.vocation ?? '?'} · level {c.level ?? '?'}
                </small>
              </button>
            ))}
            {active && (
              <button type="button" role="option" aria-selected={false} onClick={() => pick(null)}>
                <small>Nenhum (conselhos genéricos)</small>
              </button>
            )}
            <button
              type="button"
              className="ps-add"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
            >
              + Adicionar personagem
            </button>
          </div>
        )}
      </div>

      {active ? (
        <>
          <table className="ps-stats">
            <tbody>
              <tr>
                <td>Level</td>
                <td className="ps-level">{active.level ?? '—'}</td>
              </tr>
              {showWeaponPlaceholder && (
                <tr>
                  <td>Arma</td>
                  <td title="Informe sua skill de arma na aba Personagens">—</td>
                </tr>
              )}
              {skills.map((k) => (
                <tr key={k}>
                  <td>{SKILL_LABEL[k]}</td>
                  <td title={active.skills[k] === null ? `Não informado (típico ~${active.typicalSkills[k]})` : undefined}>
                    {active.skills[k] ?? '—'}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Residência</td>
                <td>{active.residence ?? '—'}</td>
              </tr>
            </tbody>
          </table>

          <div className="ps-section">
            <span className="ps-label">Quests em andamento</span>
            {doing.length ? (
              doing.map((p) => <span key={p.id}>{p.title}</span>)
            ) : (
              <span className="ps-muted">Nenhuma marcada.</span>
            )}
          </div>
        </>
      ) : (
        <div className="ps-section">
          <span className="ps-muted">
            {characters.length
              ? 'Escolha um personagem para conselhos sob medida.'
              : 'Adicione seu personagem para conselhos sob medida.'}
          </span>
          {!characters.length && (
            <button type="button" className="ps-add-btn" onClick={onAdd}>
              Adicionar personagem
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
