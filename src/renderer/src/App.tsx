import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { Character, Lang } from '../../shared/types'
import { DICTS, LangContext } from './i18n'
import Characters from './views/Characters'
import Chat from './views/Chat'
import Settings from './views/Settings'

type Tab = 'chat' | 'characters' | 'settings'

// Side rail icons (24x24 viewBox, color via currentColor).
const TABS: { id: Tab; icon: ReactElement }[] = [
  {
    id: 'chat',
    icon: (
      <>
        <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5" />
        <path d="M8 7h8M8 11h6" />
      </>
    )
  },
  {
    id: 'characters',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </>
    )
  },
  {
    id: 'settings',
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
  const [lang, setLang] = useState<Lang | null>(null)

  const refreshCharacters = useCallback(async () => {
    const list = await window.api.characters.list()
    setCharacters(list)
    setActiveId((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)))
  }, [])

  useEffect(() => {
    void refreshCharacters()
    void window.api.settings.get().then((s) => setLang(s.language))
  }, [refreshCharacters])

  useEffect(() => {
    if (lang) document.documentElement.lang = DICTS[lang].locale
  }, [lang])

  // A conversation in progress would keep answering in the previous language.
  const changeLanguage = async (next: Lang): Promise<void> => {
    await window.api.settings.setLanguage(next)
    setLang(next)
    setChatReset((n) => n + 1)
  }

  // Waits for the saved language so the UI does not flash in the other one.
  if (!lang) return null
  const t = DICTS[lang]

  return (
    <LangContext.Provider value={lang}>
      <div className="app">
        <nav className="rail" aria-label={t.app.nav}>
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
            aria-label={t.app.newChat}
            title={t.app.newChat}
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
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={'rail-btn' + (tab === item.id ? ' active' : '')}
              aria-label={t.app.tabs[item.id]}
              aria-current={tab === item.id ? 'page' : undefined}
              title={t.app.tabs[item.id]}
              onClick={() => setTab(item.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {item.icon}
              </svg>
            </button>
          ))}
        </nav>
        <main className="content">
          {/* The chat stays mounted so the conversation survives tab switches. */}
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
          {tab === 'settings' && <Settings onLanguageChange={changeLanguage} />}
        </main>
      </div>
    </LangContext.Provider>
  )
}
