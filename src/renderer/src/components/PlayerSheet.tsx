import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SKILL_KEYS, type Character, type CharacterSkills, type ProgressItem } from '../../../shared/types'
import { useT } from '../i18n'
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

// Sheet on the right of the Guia screen. The character name opens the list to switch the active one.
export default function PlayerSheet({ characters, active, onSelect, onAdd }: Props) {
  const t = useT().sheet
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

  // Closes the list on an outside click.
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

  // Only the skills that matter for the vocation (typical is null for the others). Knights use a
  // single weapon: of the three, the filled-in ones show; with none, a single "weapon" row.
  const relevant = active ? SKILL_KEYS.filter((k) => k !== 'fishing' && active.typicalSkills[k] !== null) : []
  const weapons = relevant.filter((k) => WEAPONS.includes(k))
  const informedWeapons = weapons.filter((k) => active?.skills[k] !== null)
  const showWeaponPlaceholder = weapons.length > 1 && !informedWeapons.length
  const skills = weapons.length > 1 ? relevant.filter((k) => !WEAPONS.includes(k) || informedWeapons.includes(k)) : relevant
  const portrait = active ? (active.portrait ?? active.outfitUrl) : null
  const account = active?.premium === null ? null : active?.premium ? 'Premium' : 'Free'

  return (
    <aside className="player-sheet" aria-label={t.aria}>
      <div className="ps-title">
        <span>{t.title}</span>
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
            title={t.switch}
            onClick={() => setOpen((o) => !o)}
          >
            {active?.name ?? t.none}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <strong className="ps-switch ps-empty">{t.none}</strong>
        )}
        {active && (
          <span className="ps-info">
            {[active.vocation, active.world, account].filter(Boolean).join(' · ')}
          </span>
        )}

        {open && (
          <div className="ps-menu" role="listbox" aria-label={t.list}>
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
                <small>{t.generic}</small>
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
              + {t.add}
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
                  <td>{t.weapon}</td>
                  <td title={t.weaponHint}>—</td>
                </tr>
              )}
              {skills.map((k) => (
                <tr key={k}>
                  <td>{SKILL_LABEL[k]}</td>
                  <td title={active.skills[k] === null ? t.notEntered(active.typicalSkills[k]) : undefined}>
                    {active.skills[k] ?? '—'}
                  </td>
                </tr>
              ))}
              <tr>
                <td>{t.residence}</td>
                <td>{active.residence ?? '—'}</td>
              </tr>
            </tbody>
          </table>

          <div className="ps-section">
            <span className="ps-label">{t.questsDoing}</span>
            {doing.length ? (
              doing.map((p) => <span key={p.id}>{p.title}</span>)
            ) : (
              <span className="ps-muted">{t.noneMarked}</span>
            )}
          </div>
        </>
      ) : (
        <div className="ps-section">
          <span className="ps-muted">
            {characters.length ? t.pick : t.addFirst}
          </span>
          {!characters.length && (
            <button type="button" className="ps-add-btn" onClick={onAdd}>
              {t.add}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
