import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { Character } from '../../shared/types'
import Characters from './views/Characters'
import Chat from './views/Chat'
import Settings from './views/Settings'

type Tab = 'chat' | 'characters' | 'settings'

// Ícones do menu lateral (viewBox 24x24, cor via currentColor).
const TABS: { id: Tab; label: string; icon: ReactElement }[] = [
  {
    id: 'chat',
    label: 'Guia',
    icon: (
      <>
        <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5" />
        <path d="M8 7h8M8 11h6" />
      </>
    )
  },
  {
    id: 'characters',
    label: 'Personagens',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </>
    )
  },
  {
    id: 'settings',
    label: 'Configurações',
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    )
  }
]

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [characters, setCharacters] = useState<Character[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [chatReset, setChatReset] = useState(0)

  const refreshCharacters = useCallback(async () => {
    const list = await window.api.characters.list()
    setCharacters(list)
    setActiveId((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)))
  }, [])

  useEffect(() => {
    void refreshCharacters()
  }, [refreshCharacters])

  return (
    <div className="app">
      <nav className="rail" aria-label="Navegação">
        <span className="rail-mark" aria-hidden="true" title="Dungeon Guide">
          <svg viewBox="0 0 24 24">
            <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
            <path d="m13 19 6-6" />
            <path d="m16 16 4 4" />
            <path d="m19 21 2-2" />
            <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
            <path d="m11 19-6-6" />
            <path d="m8 16-4 4" />
            <path d="m5 21-2-2" />
          </svg>
        </span>
        <button
          type="button"
          className="rail-new"
          aria-label="Nova conversa"
          title="Nova conversa"
          onClick={() => {
            setTab('chat')
            setChatReset((n) => n + 1)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <span className="rail-sep" aria-hidden="true" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'rail-btn' + (tab === t.id ? ' active' : '')}
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
            title={t.label}
            onClick={() => setTab(t.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {t.icon}
            </svg>
          </button>
        ))}
      </nav>
      <main className="content">
        {/* O chat fica montado para não perder a conversa ao trocar de aba. */}
        <div hidden={tab !== 'chat'} className="view view-chat">
          <Chat
            characters={characters}
            activeCharacter={characters.find((c) => c.id === activeId) ?? null}
            onSelectCharacter={setActiveId}
            onAddCharacter={() => setTab('characters')}
            resetSignal={chatReset}
          />
        </div>
        {tab === 'characters' && <Characters characters={characters} onChanged={refreshCharacters} />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}
