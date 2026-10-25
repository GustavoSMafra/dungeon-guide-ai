import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Character, Source } from '../../../shared/types'
import PlayerSheet from '../components/PlayerSheet'
import Wizard, { type WizardMood } from '../components/Wizard'

interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
  error?: string
  model?: string
}

const SUGGESTIONS = [
  'Quais as melhores hunts para o meu level e vocação?',
  'Qual a próxima quest que vale a pena eu fazer?',
  'Me dê um tutorial de como funciona o Bestiary.',
  'Como enfrentar um Demon com segurança?'
]

const newId = (): string => crypto.randomUUID()

interface Props {
  characters: Character[]
  activeCharacter: Character | null
  onSelectCharacter: (id: number | null) => void
  onAddCharacter: () => void
  // Incrementado pelo botão "Nova conversa" do menu lateral.
  resetSignal: number
}

export default function Chat({ characters, activeCharacter, onSelectCharacter, onAddCharacter, resetSignal }: Props) {
  const [conversationId, setConversationId] = useState(newId)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const convRef = useRef(conversationId)
  convRef.current = conversationId

  useEffect(() => {
    const updateLast = (fn: (m: Message) => Message): void =>
      setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms))
    const offs = [
      window.api.chat.onSources((e) => {
        if (e.conversationId === convRef.current) updateLast((m) => ({ ...m, sources: e.sources }))
      }),
      window.api.chat.onDelta((e) => {
        if (e.conversationId === convRef.current) updateLast((m) => ({ ...m, text: m.text + e.text }))
      }),
      window.api.chat.onDone((e) => {
        if (e.conversationId !== convRef.current) return
        updateLast((m) => ({ ...m, error: e.error, model: e.model }))
        setBusy(false)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setInput('')
    setBusy(true)
    setMessages((ms) => [...ms, { role: 'user', text: trimmed }, { role: 'assistant', text: '' }])
    await window.api.chat.send(conversationId, trimmed, activeCharacter?.id ?? null)
  }

  const reset = (): void => {
    void window.api.chat.reset(conversationId)
    setConversationId(newId())
    setMessages([])
    setBusy(false)
  }

  const lastReset = useRef(resetSignal)
  useEffect(() => {
    if (resetSignal === lastReset.current) return
    lastReset.current = resetSignal
    reset()
  }, [resetSignal])

  const last = messages[messages.length - 1]
  const mood: WizardMood = !busy ? 'idle' : last?.text ? 'speaking' : 'thinking'

  return (
    <div className="chat">
      <header className="chat-header">
        <Wizard mood={mood} />
        <div>
          <h1>O Dungeon Master</h1>
          <p className="oracle-status">
            {mood === 'thinking' ? 'consultando os tomos…' : mood === 'speaking' ? 'falando…' : 'à sua espera'}
          </p>
        </div>
      </header>

      <div className="messages">
        {!messages.length && (
          <div className="bubble wizard-says first">
            <p>
              Saudações, jovem aventureiro! Conheço os segredos de Tibia… mas só respondo a quem pergunta. Por
              onde quer começar?
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            <div key={i} className="bubble wizard-says">
              {m.text ? (
                <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
              ) : (
                !m.error &&
                !m.model && (
                  <span className="typing">
                    Hmm, deixe-me consultar os pergaminhos<span className="dots" />
                  </span>
                )
              )}
              {m.error && <p className="error">{m.error}</p>}
              {m.sources && m.sources.length > 0 && (
                <div className="sources">
                  <span>Fontes:</span>
                  {m.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ))}
                </div>
              )}
              {m.model && <small className="model-tag">{m.model}</small>}
            </div>
          ) : (
            <div key={i} className="bubble hero-says">
              <p>{m.text}</p>
            </div>
          )
        )}
        <div ref={bottom} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          placeholder="Faça sua pergunta ao Dungeon Master… (ex.: onde caçar com um Elite Knight level 120?)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
        />
        <small className="composer-hint muted">Enter envia · Shift+Enter quebra a linha</small>
        {/* Selo de cera; o d20 gira enquanto o Dungeon Master responde. */}
        <button
          type="submit"
          className={`seal${busy ? ' busy' : ''}`}
          disabled={busy || !input.trim()}
          title={busy ? 'Aguarde…' : 'Perguntar'}
          aria-label={busy ? 'Aguarde' : 'Perguntar'}
        >
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <radialGradient id="seal-wax" gradientUnits="userSpaceOnUse" cx="24" cy="20" r="44">
                <stop offset="0%" stopColor="#e85a48" />
                <stop offset="50%" stopColor="#b32a1e" />
                <stop offset="100%" stopColor="#6e140e" />
              </radialGradient>
              <g id="seal-d20" fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
                <path d="M12 2 21 7v10l-9 5-9-5V7Z" />
                <path d="M12 7l5 8H7Z" />
                <path d="M12 2v5M3 7h18M3 7l4 8M21 7l-4 8M3 17l4-2M21 17l-4-2M12 22l-5-7M12 22l5-7" />
              </g>
            </defs>
            {/* Cera: um círculo com "bolhas" na borda, de tamanhos alternados */}
            <g fill="url(#seal-wax)">
              <circle cx="32" cy="32" r="25" />
              <circle cx="32.0" cy="8.5" r="8.5" />
              <circle cx="46.5" cy="14.8" r="7.5" />
              <circle cx="55.1" cy="27.9" r="9" />
              <circle cx="51.5" cy="43.3" r="7.8" />
              <circle cx="40.0" cy="54.1" r="8.2" />
              <circle cx="24.3" cy="53.1" r="9" />
              <circle cx="11.6" cy="43.8" r="7.4" />
              <circle cx="9.8" cy="28.1" r="8.8" />
              <circle cx="16.9" cy="14.0" r="7.9" />
            </g>
            {/* Anel e d20 em baixo-relevo: um traço claro deslocado + o traço escuro por cima */}
            <circle cx="32" cy="33" r="20" fill="none" stroke="rgba(255, 190, 170, 0.35)" strokeWidth="1.5" />
            <circle cx="32" cy="32" r="20" fill="none" stroke="#6a120c" strokeWidth="2" />
            <g className="seal-mark">
              <use href="#seal-d20" transform="translate(17 18) scale(1.25)" stroke="rgba(255, 190, 170, 0.45)" />
              <use href="#seal-d20" transform="translate(17 17) scale(1.25)" stroke="#5c100b" />
            </g>
          </svg>
        </button>
      </form>

      <PlayerSheet
        characters={characters}
        active={activeCharacter}
        onSelect={onSelectCharacter}
        onAdd={onAddCharacter}
      />
    </div>
  )
}
