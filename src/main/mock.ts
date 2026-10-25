// Mock mode (`npm run dev:mock`): the chat replies with fixed text, with no AI and no search.
// Useful to check the visuals (bubbles, markdown, animations) without Ollama or an API key.

import type { WebContents } from 'electron'
import type { Source } from '../shared/types'

export const MOCK_MODE = import.meta.env.MODE === 'mock'

const MOCK_MODEL = 'mock (sem IA)'

const SOURCES: Source[] = [
  { title: 'Demon', heading: 'Estratégia', url: 'https://tibia.fandom.com/wiki/Demon' },
  { title: 'Edron Demon Forge', heading: 'Localização', url: 'https://tibia.fandom.com/wiki/Edron_Demon_Forge' },
  { title: 'Bestiary', heading: 'Visão geral', url: 'https://tibia.fandom.com/wiki/Bestiary' }
]

const ANSWER = `Ah, jovem aventureiro… vejo que buscas **sabedoria**. Esta é uma resposta de exemplo do modo mock, para você conferir o visual.

### Hunts sugeridas

| Hunt | Level | Risco |
|------|-------|-------|
| Edron Demon Forge | 130+ | alto |
| Banuta | 90–130 | moderado |
| Hero Cave | 70–100 | baixo |

Algumas dicas:

1. Leve sempre **poções de vida** extras.
2. Use \`exura gran\` quando a vida cair abaixo de 50%.
3. Evite enfrentar *Demons* sozinho sem um bom escudo.

> Lembre-se: a resposta que procuras pode estar mais perto do que imaginas.

Mais detalhes na [TibiaWiki](https://tibia.fandom.com/wiki/Main_Page).`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Type "erro" in the question to see how the bubble shows a failure.
export async function sendMockMessage(wc: WebContents, conversationId: string, text: string): Promise<void> {
  await sleep(1200) // "thinking" time, to see the Dungeon Master animation
  if (/erro/i.test(text)) {
    wc.send('chat:done', { conversationId, model: MOCK_MODEL, error: 'Erro simulado pelo modo mock.' })
    return
  }
  wc.send('chat:sources', { conversationId, sources: SOURCES })
  for (const piece of ANSWER.match(/\S+\s*/g) ?? []) {
    if (wc.isDestroyed()) return
    wc.send('chat:delta', { conversationId, text: piece })
    await sleep(35)
  }
  wc.send('chat:done', { conversationId, model: MOCK_MODEL })
}
