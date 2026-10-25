import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  SKILL_KEYS,
  type Character,
  type CharacterSkills,
  type LevelEntry,
  type ProgressItem,
  type ProgressKind,
  type ProgressStatus
} from '../../../shared/types'
import VocationIcon from '../components/VocationIcon'

const KINDS: { id: ProgressKind; label: string; plural: string }[] = [
  { id: 'quest', label: 'Quest', plural: 'Quests' },
  { id: 'access', label: 'Acesso', plural: 'Acessos' },
  { id: 'goal', label: 'Meta', plural: 'Metas' }
]
const KIND_LABEL: Record<ProgressKind, string> = { quest: 'quest', access: 'acesso', goal: 'meta' }

const NEXT_STATUS: Record<ProgressStatus, ProgressStatus> = { todo: 'doing', doing: 'done', done: 'todo' }
const STATUS_LABEL: Record<ProgressStatus, string> = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' }

interface Props {
  characters: Character[]
  onChanged: () => Promise<void>
}

// Names as they appear in Tibia's skills window.
const SKILL_LABEL: Record<keyof CharacterSkills, string> = {
  magicLevel: 'Magic Level',
  fist: 'Fist Fighting',
  club: 'Club Fighting',
  sword: 'Sword Fighting',
  axe: 'Axe Fighting',
  distance: 'Distance Fighting',
  shielding: 'Shielding',
  fishing: 'Fishing'
}

const cleanError = (e: unknown): string =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Downscales the chosen image to at most 256px so it stays small in the database.
function loadPortrait(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 256 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Não foi possível ler a imagem'))
    img.src = URL.createObjectURL(file)
  })
}

// Closes a menu/popover on an outside click or on Esc.
function useDismiss(open: boolean, close: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function AddCharacter({ onAdded, autoFocus }: { onAdded: (c: Character) => Promise<void>; autoFocus?: boolean }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const add = async (): Promise<void> => {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const c = await window.api.characters.add(name)
      setName('')
      await onAdded(c)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      className="ch-add"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <label htmlFor="ch-add-name">Nome do personagem no Tibia</label>
      <div className="ch-inline">
        <input
          id="ch-add-name"
          value={name}
          autoFocus={autoFocus}
          placeholder="Ex.: Bubble"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary" disabled={loading || !name.trim()}>
          {loading ? 'Buscando…' : 'Adicionar'}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      <p className="muted small">Os dados públicos vêm do Tibia.com via TibiaData. O progresso fica salvo só no seu PC.</p>
    </form>
  )
}

export default function Characters({ characters, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(characters[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const addRef = useDismiss(adding, () => setAdding(false))

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0] ?? null

  const onAdded = async (c: Character): Promise<void> => {
    await onChanged()
    setSelectedId(c.id)
    setAdding(false)
  }

  return (
    <div className="characters">
      <div className="ch-top">
        <h1>Personagens</h1>
        {characters.length > 0 && (
          <div className="ch-chips" role="tablist" aria-label="Seus personagens">
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={selected?.id === c.id}
                className={'ch-chip' + (selected?.id === c.id ? ' active' : '')}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="ch-chip-icon">
                  <VocationIcon vocation={c.vocation} />
                </span>
                {c.name}
                <small>{c.level ?? '?'}</small>
              </button>
            ))}
            <div className="ch-add-wrap" ref={addRef}>
              <button
                type="button"
                className="ch-chip-add"
                aria-label="Adicionar personagem"
                aria-expanded={adding}
                title="Adicionar personagem"
                onClick={() => setAdding((a) => !a)}
              >
                +
              </button>
              {adding && (
                <div className="ch-popover">
                  <AddCharacter onAdded={onAdded} autoFocus />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selected ? (
        <CharacterDetail key={selected.id} character={selected} onChanged={onChanged} />
      ) : (
        <section className="ch-card ch-empty">
          <h2>Adicione seu primeiro personagem</h2>
          <p className="muted">
            Com o personagem cadastrado, o Dungeon Master recomenda hunts e quests para o seu level, vocação e tipo de
            conta.
          </p>
          <AddCharacter onAdded={onAdded} />
        </section>
      )}
    </div>
  )
}

// Characters saved before portraits existed get sex and outfit through an automatic sync.
const autoSynced = new Set<number>()

function CharacterDetail({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<LevelEntry[]>([])
  const [items, setItems] = useState<ProgressItem[]>([])
  const [notes, setNotes] = useState(character.notes)
  const [syncing, setSyncing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false))
  const fileInput = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setHistory(await window.api.characters.levelHistory(character.id))
    setItems(await window.api.characters.progress(character.id))
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, character.level])

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.characters.sync(character.id)
      await onChanged()
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (character.outfitUrl || autoSynced.has(character.id)) return
    autoSynced.add(character.id)
    void sync().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id])

  const choosePortrait = async (file: File | undefined): Promise<void> => {
    if (!file) return
    await window.api.characters.setPortrait(character.id, await loadPortrait(file))
    await onChanged()
  }

  const src = character.portrait ?? character.outfitUrl
  const synced = character.lastSyncedAt ? new Date(character.lastSyncedAt).toLocaleString('pt-BR') : 'nunca'

  const attrs: { label: string; value: ReactNode }[] = [
    { label: 'Vocação', value: character.vocation ?? '—' },
    { label: 'Level', value: <strong className="ch-level">{character.level ?? '—'}</strong> },
    { label: 'Mundo', value: character.world ?? '—' },
    { label: 'Residência', value: character.residence ?? '—' },
    { label: 'Sexo', value: character.sex === 'female' ? 'Feminino' : character.sex === 'male' ? 'Masculino' : '—' },
    { label: 'Guild', value: character.guild ?? '—' }
  ]

  return (
    <div className="ch-grid">
      <div className="ch-col">
        <section className="ch-card ch-head">
          <div className={'ch-portrait' + (character.portrait ? '' : ' outfit')}>
            {src ? (
              <img src={src} alt={`Retrato de ${character.name}`} />
            ) : (
              <VocationIcon vocation={character.vocation} />
            )}
          </div>
          <div className="ch-head-body">
            <div className="ch-head-title">
              <h2>{character.name}</h2>
              <div className="ch-head-actions">
                <button
                  type="button"
                  className="ghost square"
                  aria-label="Atualizar do Tibia.com"
                  title={`Atualizar do Tibia.com (última vez: ${synced})`}
                  disabled={syncing}
                  onClick={() => void sync()}
                >
                  <span className={syncing ? 'ch-spin' : ''}>↻</span>
                </button>
                <div className="ch-menu-wrap" ref={menuRef}>
                  <button
                    type="button"
                    className="ghost square"
                    aria-label="Mais opções"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div className="ch-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          fileInput.current?.click()
                        }}
                      >
                        Trocar imagem
                      </button>
                      {character.portrait && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={async () => {
                            setMenuOpen(false)
                            await window.api.characters.setPortrait(character.id, null)
                            await onChanged()
                          }}
                        >
                          Usar outfit da vocação
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={async () => {
                          setMenuOpen(false)
                          if (!confirm(`Remover ${character.name} e todo o progresso salvo?`)) return
                          await window.api.characters.remove(character.id)
                          await onChanged()
                        }}
                      >
                        Remover personagem
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    void choosePortrait(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <dl className="ch-attrs">
              {attrs.map((a) => (
                <div key={a.label}>
                  <dt>{a.label}</dt>
                  <dd>{a.value}</dd>
                </div>
              ))}
              <div className="ch-attr-wide">
                <dt>
                  <label htmlFor="ch-account">Conta</label>
                </dt>
                <dd>
                  <select
                    id="ch-account"
                    value={character.premiumOverride === null ? 'auto' : character.premiumOverride ? 'premium' : 'free'}
                    onChange={async (e) => {
                      const v = e.target.value
                      await window.api.characters.setPremiumOverride(character.id, v === 'auto' ? null : v === 'premium')
                      await onChanged()
                    }}
                  >
                    <option value="auto">
                      Automático ({character.premiumAuto === null ? '?' : character.premiumAuto ? 'Premium' : 'Free'})
                    </option>
                    <option value="premium">Premium</option>
                    <option value="free">Free</option>
                  </select>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <SkillsCard character={character} onChanged={onChanged} />
        <LevelCard history={history} />
      </div>

      <div className="ch-col">
        <ProgressCard characterId={character.id} items={items} reload={load} />

        <section className="ch-card">
          <h3>
            <label htmlFor="ch-notes">Anotações</label>
          </h3>
          <textarea
            id="ch-notes"
            rows={5}
            value={notes}
            placeholder="Equipamento atual, imbuements, onde parou na hunt…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void window.api.characters.saveNotes(character.id, notes)}
          />
          <small className="muted">O Dungeon Master também lê isto.</small>
        </section>
      </div>
    </div>
  )
}

type SkillDraft = Record<keyof CharacterSkills, string>

// Tibia.com does not publish skills: the player fills them in, and the risk model uses the
// level's typical value for empty fields. Only the ones that count for the vocation are highlighted.
function SkillsCard({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const toDraft = (s: CharacterSkills): SkillDraft =>
    Object.fromEntries(SKILL_KEYS.map((k) => [k, s[k]?.toString() ?? ''])) as SkillDraft
  const [draft, setDraft] = useState(toDraft(character.skills))
  const [showAll, setShowAll] = useState(false)

  const save = async (): Promise<void> => {
    const parse = (v: string): number | null => (v.trim() === '' ? null : Number(v))
    await window.api.characters.setSkills(
      character.id,
      Object.fromEntries(SKILL_KEYS.map((k) => [k, parse(draft[k])])) as unknown as CharacterSkills
    )
    await onChanged()
  }

  const key = SKILL_KEYS.filter((k) => character.typicalSkills[k] !== null)
  const shown = showAll ? SKILL_KEYS : key

  return (
    <section className="ch-card">
      <div className="ch-card-title">
        <h3>Skills</h3>
        <small className="muted">em branco = típico do level</small>
      </div>
      <div className="ch-skills">
        {shown.map((k) => {
          const typical = character.typicalSkills[k]
          return (
            <label key={k} className={'ch-skill' + (typical !== null ? ' key' : '')}>
              <span>{SKILL_LABEL[k]}</span>
              <input
                type="number"
                min={0}
                max={200}
                value={draft[k]}
                placeholder={typical !== null ? String(typical) : '—'}
                title={typical !== null ? `Típico do level: ~${typical}` : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                onBlur={() => void save()}
              />
            </label>
          )
        })}
      </div>
      {key.length < SKILL_KEYS.length && (
        <button type="button" className="link" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Mostrar só as da vocação' : 'Mostrar todas as skills'}
        </button>
      )}
    </section>
  )
}

function LevelCard({ history }: { history: LevelEntry[] }) {
  const points = [...history].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const first = points[0]
  const last = points[points.length - 1]
  const days = first && last ? Math.max(1, Math.round((Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / 86400000)) : 0

  // Points in the 400x110 viewBox: x by time, y by level (higher level = higher up).
  let coords: [number, number][] = []
  if (points.length > 1) {
    const t0 = Date.parse(first.recordedAt)
    const span = Math.max(1, Date.parse(last.recordedAt) - t0)
    const levels = points.map((p) => p.level)
    const lo = Math.min(...levels)
    const hi = Math.max(...levels)
    coords = points.map((p) => [
      10 + ((Date.parse(p.recordedAt) - t0) / span) * 380,
      hi === lo ? 55 : 100 - ((p.level - lo) / (hi - lo)) * 86
    ])
  }
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const end = coords[coords.length - 1]

  return (
    <section className="ch-card">
      <div className="ch-card-title">
        <h3>Evolução de level</h3>
        {points.length > 1 && (
          <small className="ch-gain">
            {first.level} → {last.level} em {days} {days === 1 ? 'dia' : 'dias'}
          </small>
        )}
      </div>
      {points.length > 1 && end ? (
        <svg
          className="ch-chart"
          viewBox="0 0 400 110"
          role="img"
          aria-label={`Level foi de ${first.level} para ${last.level} em ${days} dias`}
        >
          <path d="M0 100 H400 M0 57 H400 M0 14 H400" className="ch-chart-grid" />
          <path d={`${path} L${end[0].toFixed(1)} 100 L10 100 Z`} className="ch-chart-area" />
          <path d={path} className="ch-chart-line" />
          <circle cx={end[0]} cy={end[1]} r="4.5" className="ch-chart-dot" />
        </svg>
      ) : (
        <p className="muted small">O gráfico aparece depois de algumas sincronizações com o Tibia.com.</p>
      )}
    </section>
  )
}

function ProgressCard({
  characterId,
  items,
  reload
}: {
  characterId: number
  items: ProgressItem[]
  reload: () => Promise<void>
}) {
  const [filter, setFilter] = useState<ProgressKind | 'all'>('all')
  const [kind, setKind] = useState<ProgressKind>('quest')
  const [title, setTitle] = useState('')

  const shown = items.filter((i) => filter === 'all' || i.kind === filter)
  const filters: { id: ProgressKind | 'all'; label: string }[] = [{ id: 'all', label: 'Todos' }, ...KINDS.map((k) => ({ id: k.id, label: k.plural }))]

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    await window.api.characters.addProgress(characterId, kind, title)
    setTitle('')
    await reload()
  }

  return (
    <section className="ch-card">
      <div className="ch-card-title">
        <h3>Progresso</h3>
        <div className="segmented small" role="tablist" aria-label="Filtrar por tipo">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'on' : ''}
              onClick={() => {
                setFilter(f.id)
                if (f.id !== 'all') setKind(f.id)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="ch-progress">
        {shown.map((i) => (
          <li key={i.id} className={i.status}>
            <button
              type="button"
              className="ch-status"
              aria-label={`${STATUS_LABEL[i.status]}: avançar status de ${i.title}`}
              title={`${STATUS_LABEL[i.status]} (clique para avançar)`}
              onClick={async () => {
                await window.api.characters.setProgressStatus(i.id, NEXT_STATUS[i.status])
                await reload()
              }}
            >
              {i.status === 'done' ? '✓' : i.status === 'doing' ? '•' : ''}
            </button>
            <span className="ch-progress-title">{i.title}</span>
            <small className="ch-progress-meta">
              {filter === 'all' && <>{KIND_LABEL[i.kind]} · </>}
              {STATUS_LABEL[i.status]}
            </small>
            <button
              type="button"
              className="ch-remove"
              aria-label={`Remover ${i.title}`}
              title="Remover"
              onClick={async () => {
                await window.api.characters.removeProgress(i.id)
                await reload()
              }}
            >
              ×
            </button>
          </li>
        ))}
        {!shown.length && <li className="ch-progress-empty muted">Nada aqui ainda.</li>}
      </ul>

      <form
        className="ch-inline"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <select aria-label="Tipo do item" value={kind} onChange={(e) => setKind(e.target.value as ProgressKind)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Novo item"
          value={title}
          placeholder={kind === 'quest' ? 'Ex.: The Inquisition Quest' : kind === 'access' ? 'Ex.: Roshamuul' : 'Ex.: Chegar ao level 200'}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="primary square" aria-label="Adicionar item" disabled={!title.trim()}>
          +
        </button>
      </form>
    </section>
  )
}
