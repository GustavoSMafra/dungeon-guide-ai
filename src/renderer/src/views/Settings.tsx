import { type ReactNode, useEffect, useState } from 'react'
import {
  WIKI_CATEGORIES,
  type IngestProgress,
  type KnowledgeStats,
  type Provider,
  type SettingsView
} from '../../../shared/types'

type Section = 'ai' | 'library' | 'about'

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'ai', label: 'Inteligência', hint: 'Claude ou Ollama' },
  { id: 'library', label: 'Biblioteca', hint: 'Base da TibiaWiki' },
  { id: 'about', label: 'Sobre', hint: 'Créditos e licenças' }
]

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'ollama', label: 'Ollama' }
]

const CATEGORY_HINTS: Record<string, string> = {
  Creatures: 'Atributos, loot, fraquezas e resistências de cada criatura.',
  Bosses: 'Mecânicas, requisitos e recompensas dos bosses.',
  'Hunting Places': 'Níveis indicados, criaturas e rotas de cada hunt.',
  'Quest Overview Pages': 'Requisitos, passos e recompensas das quests.',
  Spells: 'Magias por vocação, nível, mana e custo.',
  Achievements: 'Como obter cada achievement e quantos pontos vale.'
}

const fmt = (n: number | undefined): string => (n === undefined ? '…' : n.toLocaleString('pt-BR'))

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

// Linha de configuração: nome e explicação à esquerda, controle à direita.
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

export default function Settings() {
  const [section, setSection] = useState<Section>('ai')
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [apiKey, setApiKeyInput] = useState('')
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [selected, setSelected] = useState<string[]>(['Creatures', 'Bosses', 'Hunting Places', 'Quest Overview Pages'])
  const [sample, setSample] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)

  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)
  const [ollamaError, setOllamaError] = useState<string | null>(null)

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

  const running = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'

  const modelOptions = ollamaModels?.length
    ? [
        ...(settings && !ollamaModels.includes(settings.ollamaModel)
          ? [{ value: settings.ollamaModel, label: `${settings.ollamaModel} (não instalado)` }]
          : []),
        ...ollamaModels.map((m) => ({ value: m, label: m }))
      ]
    : []

  const keyStatus = settings?.hasApiKey
    ? settings.apiKeyFromEnv
      ? 'Usando ANTHROPIC_API_KEY do ambiente'
      : 'Chave configurada'
    : 'Nenhuma chave configurada'

  const startIngest = (): void => {
    setProgress({ phase: 'listing', done: 0, total: 0, message: 'Iniciando…' })
    window.api.knowledge.ingest(selected, sample ? 50 : null).catch(() => {})
  }
  const startUpdate = (): void => {
    setProgress({ phase: 'listing', done: 0, total: 0, message: 'Buscando mudanças…' })
    window.api.knowledge.update().catch(() => {})
  }

  return (
    <div className="settings">
      <aside className="set-nav" aria-label="Seções">
        <h1>Configurações</h1>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={section === s.id ? 'active' : ''}
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            <span>{s.label}</span>
            <small>{s.hint}</small>
          </button>
        ))}
      </aside>

      <main className="set-body">
        {section === 'ai' && (
          <section aria-labelledby="set-ai">
            <h2 id="set-ai">Inteligência</h2>
            <p className="set-lead">Quem dá voz ao Dungeon Master.</p>

            <Row
              title="Provedor"
              desc="Claude roda na nuvem e dá as respostas mais precisas, mas precisa de uma chave da API. Ollama roda no seu computador: grátis e offline, porém mais lento e menos preciso."
            >
              <div className="segmented" role="radiogroup" aria-label="Provedor">
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
                title={<label htmlFor="set-key">Chave da API do Claude</label>}
                desc="Fica criptografada pelo cofre do sistema e só sai deste computador para falar com a API da Anthropic. Envie o campo vazio para apagá-la. Crie uma em console.anthropic.com."
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
                    placeholder={settings?.hasApiKey ? '••••••••  (trocar chave)' : 'sk-ant-…'}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button type="submit">Salvar</button>
                </form>
              </Row>
            )}

            {settings?.provider === 'ollama' && (
              <Row
                title={<label htmlFor="set-model">Modelo local</label>}
                desc={
                  <>
                    Modelo instalado no Ollama que o Dungeon Master vai usar. Para instalar outro, rode no terminal:{' '}
                    <code>ollama pull &lt;modelo&gt;</code>
                  </>
                }
                extra={
                  !modelOptions.length && (
                    <span className={ollamaError ? 'error small' : 'muted small'}>
                      {ollamaError ?? 'Nenhum modelo instalado. Rode no terminal: ollama pull qwen3:8b'}
                    </span>
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
                    aria-label="Recarregar modelos"
                    title="Recarregar modelos"
                    onClick={() => void loadOllamaModels()}
                  >
                    ↻
                  </button>
                </div>
              </Row>
            )}
          </section>
        )}

        {section === 'library' && (
          <section aria-labelledby="set-lib">
            <h2 id="set-lib">Biblioteca</h2>
            <p className="set-lead">
              {stats
                ? `${fmt(stats.pages)} páginas · ${fmt(stats.hunts)} hunts · ${fmt(stats.creatures)} criaturas · ${fmt(stats.quests)} quests · ` +
                  (stats.lastIngestAt
                    ? `atualizada em ${new Date(stats.lastIngestAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                    : 'ainda não indexada')
                : 'Carregando…'}
            </p>

            <Row
              title="Atualizar a base"
              desc="“Só as mudanças” baixa apenas o que mudou na wiki e leva segundos. “Indexar tudo” refaz a base com as categorias abaixo e leva alguns minutos; na primeira vez, o modelo de busca (~120 MB) é baixado."
            >
              <div className="set-inline">
                <button type="button" className="ghost" disabled={running || !selected.length} onClick={startIngest}>
                  {running ? 'Indexando…' : 'Indexar tudo'}
                </button>
                <button type="button" className="primary" disabled={running || !stats?.lastIngestAt} onClick={startUpdate}>
                  Só as mudanças
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

            <h3 className="set-group">Categorias da TibiaWiki</h3>
            {WIKI_CATEGORIES.map((c) => (
              <Row key={c.id} title={c.label} desc={CATEGORY_HINTS[c.id]}>
                <Switch
                  label={c.label}
                  checked={selected.includes(c.id)}
                  disabled={running}
                  onChange={(on) => setSelected((s) => (on ? [...s, c.id] : s.filter((x) => x !== c.id)))}
                />
              </Row>
            ))}
            <Row
              title="Modo amostra"
              desc="Indexa só 50 páginas por categoria, em ordem alfabética, para testar rápido."
              extra={
                sample && (
                  <span className="error small">
                    A amostra deixa de fora a maioria das hunts e criaturas, e as recomendações ficam incompletas.
                  </span>
                )
              }
            >
              <Switch label="Modo amostra" checked={sample} disabled={running} onChange={setSample} />
            </Row>
          </section>
        )}

        {section === 'about' && (
          <section aria-labelledby="set-about">
            <h2 id="set-about">Sobre</h2>
            <p className="set-lead">Dungeon Guide AI, um companheiro de jogo para Tibia.</p>
            <Row
              title="Conteúdo"
              desc="Dados da TibiaWiki (tibia.fandom.com), sob licença CC BY-SA. Dados estruturados via TibiaData (tibiadata.bytewizards.de)."
            />
            <Row title="Personagens" desc="Dados públicos do Tibia.com via TibiaData API (tibiadata.com). O progresso fica salvo só neste computador." />
            <Row title="Marca" desc="Tibia é uma marca da CipSoft GmbH. Este app não é afiliado à CipSoft." />
          </section>
        )}
      </main>
    </div>
  )
}
