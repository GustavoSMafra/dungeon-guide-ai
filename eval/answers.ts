// Answer evaluation: runs eval/answers.json through the real chat pipeline (the configured provider), each
// question in a fresh conversation, and saves what was retrieved, the prompt, the answer and the name
// check to out/eval/answers-<label>.json plus a readable .md. Scoring the answers stays manual.
// Usage: npm run eval:answers -- --label=before [--data=<userData dir>] [--character=<name>] [--same-session]
// --same-session sends all questions to one conversation, as a player would in one chat.

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WebContents } from 'electron'

interface Case {
  id: string
  q: string
  // Page titles (or a prefix of one: "The Djinn War" covers both faction pages) the answer depends on.
  main: string[]
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const data = arg('data')
app.setPath('userData', data ?? join(app.getPath('appData'), 'dungeon-guide-ai'))
const label = arg('label') ?? 'run'
const sameSession = process.argv.includes('--same-session')

app.whenReady().then(async () => {
  // Imported after setPath: the database and settings are opened from userData on first use.
  const { sendMessage } = await import('../src/main/chat')
  const { setDebugSink } = await import('../src/main/debug')
  const { getDb } = await import('../src/main/db')
  type DebugRecord = import('../src/main/debug').DebugRecord

  const cases = JSON.parse(readFileSync(join(process.cwd(), 'eval', 'answers.json'), 'utf8')) as Case[]
  const charName = arg('character')
  const character = (
    charName
      ? getDb().prepare('SELECT id, name FROM characters WHERE name = ?').get(charName)
      : getDb().prepare('SELECT id, name FROM characters ORDER BY id LIMIT 1').get()
  ) as { id: number; name: string } | undefined
  console.log(`character: ${character?.name ?? '(none)'}`)

  const results: (DebugRecord & { id: string; main: string[]; mainFound: string[]; shown: string })[] = []
  for (const c of cases) {
    let record: DebugRecord | null = null
    setDebugSink((r) => (record = r))
    let shown = ''
    const start = Date.now()
    await new Promise<void>((resolve) => {
      const wc = {
        send: (channel: string, payload: { text?: string; error?: string }) => {
          if (channel === 'chat:delta') shown += payload.text ?? ''
          if (channel === 'chat:replace') shown = payload.text ?? ''
          if (channel === 'chat:done') resolve()
        }
      } as unknown as WebContents
      const conversation = sameSession ? `eval-${label}` : `eval-${label}-${c.id}-${Date.now()}`
      void sendMessage(wc, conversation, c.q, character?.id ?? null)
    })
    const r = record as DebugRecord | null
    if (!r) throw new Error(`no debug record for ${c.id}`)
    const context = r.contextSources.map((s) => s.toLowerCase())
    const mainFound = c.main.filter((m) => context.some((s) => s.startsWith(m.toLowerCase())))
    results.push({ ...r, id: c.id, main: c.main, mainFound, shown })
    console.log(
      `${c.id} ${Math.round((Date.now() - start) / 1000)}s  main ${mainFound.length}/${c.main.length}` +
        `  unverified: ${r.unverified.join(', ') || '-'}  judge: ${r.judge === null ? 'off' : r.judge.length}` +
        (r.shortCircuit ? `  [${r.shortCircuit}]` : '')
    )
  }

  const dir = join(process.cwd(), 'out', 'eval')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `answers-${label}.json`), JSON.stringify(results, null, 2))
  const md = results.map((r) =>
    [
      `## ${r.id}. ${r.question}`,
      `- Search query: \`${r.searchQuery.replace(/\n/g, ' ⏎ ')}\``,
      `- Named pages: ${r.search?.namedPages.join(', ') || '-'}`,
      `- Main entity in context: ${r.mainFound.length}/${r.main.length} (${r.main.join(', ') || 'none expected'})`,
      `- Context sources: ${r.contextSources.join(', ') || '-'}`,
      `- Shown sources: ${r.sources.join(', ') || '-'}`,
      `- Blocks: ${r.blocks.map((b) => b.slice(1, b.indexOf('>'))).join(', ') || '-'}`,
      r.shortCircuit ? `- Short circuit: ${r.shortCircuit}` : null,
      `- Name check removed: ${r.unverified.join(', ') || '-'}`,
      `- Judge removed: ${r.judge === null ? '(not run)' : r.judge.map((f) => `"${f.quote}" (${f.reason})`).join('; ') || '-'}`,
      '',
      '| # | title / section | fused | vec | kw | named | rerank | kept |',
      '|---|---|---|---|---|---|---|---|',
      ...(r.search?.candidates ?? [])
        .slice(0, 12)
        .map(
          (c) =>
            `| ${c.rank} | ${c.title} / ${c.heading} | ${c.fused} | ${c.vectorRank ?? ''} | ${c.keywordRank ?? ''} | ` +
            `${c.named ? 'yes' : ''} | ${c.rerank ?? ''} | ${c.kept ? '✔' : ''} |`
        ),
      '',
      '**Answer shown**',
      '',
      r.shown.trim(),
      ''
    ]
      .filter((l) => l !== null)
      .join('\n')
  )
  writeFileSync(join(dir, `answers-${label}.md`), md.join('\n\n---\n\n') + '\n')
  console.log(`saved out/eval/answers-${label}.json and .md`)
  app.quit()
})
