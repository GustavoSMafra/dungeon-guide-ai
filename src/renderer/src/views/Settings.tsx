import { type ReactNode, useEffect, useState } from 'react'
import {
  WIKI_CATEGORIES,
  type IngestProgress,
  type KnowledgeStats,
  type Lang,
  type Provider,
  type SettingsView,
  type WikiCategory
} from '../../../shared/types'
import { useLang, useT } from '../i18n'

type Section = 'general' | 'ai' | 'library' | 'about'

const SECTIONS: Section[] = ['general', 'ai', 'library', 'about']

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'ollama', label: 'Ollama' }
]

// Each language is shown in itself, so a player can always find their own.
const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' }
]

function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={'switch' + (checked ? ' on' : '')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

// Settings row: label and description on the left, control on the right.
function Row({ title, desc, children, extra }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <strong>{title}</strong>
        {desc && <p>{desc}</p>}
        {extra}
      </div>
      {children && <div className="set-row-control">{children}</div>}
    </div>
  )
}

export default function Settings({ onLanguageChange }: { onLanguageChange: (lang: Lang) => Promise<void> }) {
  const t = useT()
  const s = t.settings
  const lang = useLang()
  const [section, setSection] = useState<Section>('general')
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [apiKey, setApiKeyInput] = useState('')
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [selected, setSelected] = useState<WikiCategory[]>(['Creatures', 'Bosses', 'Hunting Places', 'Quest Overview Pages'])
  const [sample, setSample] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)

  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  const [ollamaError, setOllamaError] = useState<string | null>(null)

  const fmt = (n: number | undefined): string => (n === undefined ? '…' : n.toLocaleString(t.locale))

  const refresh = async (): Promise<void> => {
    setSettings(await window.api.settings.get())
    setStats(await window.api.knowledge.stats())
  }

  const loadOllamaModels = async (): Promise<void> => {
    try {
      setOllamaModels(await window.api.settings.ollamaModels())
      setOllamaError(null)
    } catch (e) {
      setOllamaModels(null)
      setOllamaError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const chooseProvider = async (provider: Provider, ollamaModel: string): Promise<void> => {
    await window.api.settings.setProvider(provider, ollamaModel)
    await refresh()
  }

  useEffect(() => {
    void refresh()
    void loadOllamaModels()
    return window.api.knowledge.onProgress((p) => {
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'error') void refresh()
    })
  }, [])

  // The Ollama error comes from the main process in the language active at the time.
  useEffect(() => {
    if (ollamaError) void loadOllamaModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const running = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'

  const modelOptions = ollamaModels?.length
    ? [
        ...(settings && !ollamaModels.includes(settings.ollamaModel)
          ? [{ value: settings.ollamaModel, label: s.notInstalled(settings.ollamaModel) }]
          : []),
        ...ollamaModels.map((m) => ({ value: m, label: m }))
      ]
    : []

  const keyStatus = settings?.hasApiKey ? (settings.apiKeyFromEnv ? s.keyFromEnv : s.keySet) : s.keyNone

  const startIngest = (): void => {
    setProgress({ phase: 'listing', done: 0, total: 0, message: s.starting })
    window.api.knowledge.ingest(selected, sample ? 50 : null).catch(() => {})
  }
  const startUpdate = (): void => {
    setProgress({ phase: 'listing', done: 0, total: 0, message: s.fetchingChanges })
    window.api.knowledge.update().catch(() => {})
  }

  return (
    <div className="settings">
      <aside className="set-nav" aria-label={s.sections}>
        <h1>{s.title}</h1>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className={section === id ? 'active' : ''}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            <span>{s.nav[id].label}</span>
            <small>{s.nav[id].hint}</small>
          </button>
        ))}
      </aside>

      <main className="set-body">
        {section === 'general' && (
          <section aria-labelledby="set-general">
            <h2 id="set-general">{s.nav.general.label}</h2>
            <p className="set-lead">{s.generalLead}</p>

            <Row title={s.language} desc={s.languageDesc}>
              <div className="segmented" role="radiogroup" aria-label={s.language}>
                {LANGUAGES.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    lang={l.value === 'pt' ? 'pt-BR' : 'en'}
                    aria-checked={lang === l.value}
                    className={lang === l.value ? 'on' : ''}
                    onClick={() => {
                      if (l.value !== lang) void onLanguageChange(l.value)
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </Row>
          </section>
        )}

        {section === 'ai' && (
          <section aria-labelledby="set-ai">
            <h2 id="set-ai">{s.nav.ai.label}</h2>
            <p className="set-lead">{s.aiLead}</p>

            <Row title={s.provider} desc={s.providerDesc}>
              <div className="segmented" role="radiogroup" aria-label={s.provider}>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={settings?.provider === p.value}
                    className={settings?.provider === p.value ? 'on' : ''}
                    disabled={!settings}
                    onClick={() => void chooseProvider(p.value, settings?.ollamaModel ?? '')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Row>

            {settings?.provider !== 'ollama' && (
              <Row
                title={<label htmlFor="set-key">{s.apiKey}</label>}
                desc={s.apiKeyDesc}
                extra={
                  <span className={'status-pill' + (settings?.hasApiKey ? ' ok' : '')}>
                    <i aria-hidden="true" />
                    {keyStatus}
                  </span>
                }
              >
                <form
                  className="set-inline"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    await window.api.settings.setApiKey(apiKey)
                    setApiKeyInput('')
                    await refresh()
                  }}
                >
                  <input
                    id="set-key"
                    type="password"
                    value={apiKey}
                    placeholder={settings?.hasApiKey ? s.keyReplace : 'sk-ant-…'}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button type="submit">{s.save}</button>
                </form>
              </Row>
            )}

            {settings?.provider === 'ollama' && (
              <Row
                title={<label htmlFor="set-model">{s.localModel}</label>}
                desc={
                  <>
                    {s.localModelDesc} <code>ollama pull {s.modelArg}</code>
                  </>
                }
                extra={
                  !modelOptions.length && (
                    <span className={ollamaError ? 'error small' : 'muted small'}>{ollamaError ?? s.noModels}</span>
                  )
                }
              >
                <div className="set-inline">
                  <select
                    id="set-model"
                    value={settings.ollamaModel}
                    disabled={!modelOptions.length}
                    onChange={(e) => void chooseProvider('ollama', e.target.value)}
                  >
                    {modelOptions.length ? (
                      modelOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))
                    ) : (
                      <option>{settings.ollamaModel}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    className="ghost square"
                    aria-label={s.reloadModels}
                    title={s.reloadModels}
                    onClick={() => void loadOllamaModels()}
                  >
                    ↻
                  </button>
                </div>
              </Row>
            )}

            {settings?.provider === 'ollama' && (
              <Row title={s.judge} desc={s.judgeDesc}>
                <Switch
                  label={s.judge}
                  checked={settings.judge}
                  onChange={async (on) => {
                    await window.api.settings.setJudge(on)
                    await refresh()
                  }}
                />
              </Row>
            )}
          </section>
        )}

        {section === 'library' && (
          <section aria-labelledby="set-lib">
            <h2 id="set-lib">{s.nav.library.label}</h2>
            <p className="set-lead">
              {stats
                ? s.stats(fmt(stats.pages), fmt(stats.hunts), fmt(stats.creatures), fmt(stats.quests)) +
                  (stats.lastIngestAt
                    ? s.updatedAt(
                        new Date(stats.lastIngestAt).toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'short' })
                      )
                    : s.notIndexed)
                : s.loading}
            </p>
            {stats?.reindexNeeded && <p className="set-notice">{s.reindexNeeded}</p>}

            <Row title={s.update} desc={s.updateDesc}>
              <div className="set-inline">
                <button type="button" className="ghost" disabled={running || !selected.length} onClick={startIngest}>
                  {running ? s.indexing : s.indexAll}
                </button>
                <button type="button" className="primary" disabled={running || !stats?.lastIngestAt} onClick={startUpdate}>
                  {s.onlyChanges}
                </button>
              </div>
            </Row>

            {progress && (
              <div className={'xp' + (progress.phase === 'error' ? ' failed' : '')}>
                <div className="xp-bar">
                  <div
                    className={'xp-fill' + (running ? ' active' : '')}
                    style={{
                      width:
                        progress.total > 0
                          ? `${(progress.done / progress.total) * 100}%`
                          : progress.phase === 'done'
                            ? '100%'
                            : '0%'
                    }}
                  />
                  {progress.total > 0 && (
                    <span className="xp-count">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </div>
                <p className={progress.phase === 'error' ? 'error small' : 'muted small'}>{progress.message}</p>
              </div>
            )}

            <h3 className="set-group">{s.categories}</h3>
            {WIKI_CATEGORIES.map((id) => (
              <Row key={id} title={s.category[id].label} desc={s.category[id].hint}>
                <Switch
                  label={s.category[id].label}
                  checked={selected.includes(id)}
                  disabled={running}
                  onChange={(on) => setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)))}
                />
              </Row>
            ))}
            <Row title={s.sample} desc={s.sampleDesc} extra={sample && <span className="error small">{s.sampleWarn}</span>}>
              <Switch label={s.sample} checked={sample} disabled={running} onChange={setSample} />
            </Row>
          </section>
        )}

        {section === 'about' && (
          <section aria-labelledby="set-about">
            <h2 id="set-about">{s.nav.about.label}</h2>
            <p className="set-lead">{s.aboutLead}</p>
            <Row title={s.content} desc={s.contentDesc} />
            <Row title={s.charactersTitle} desc={s.charactersDesc} />
            <Row title={s.brand} desc={s.brandDesc} />
          </section>
        )}
      </main>
    </div>
  )
}
