// Mock mode (`npm run dev:mock`): the chat replies with fixed text, with no AI and no search.
// Useful to check the visuals (bubbles, markdown, animations) without Ollama or an API key.

import type { WebContents } from 'electron'
import { getLanguage } from './settings'
import type { Lang, Source } from '../shared/types'

export const MOCK_MODE = import.meta.env.MODE === 'mock'

const MOCK: Record<Lang, { model: string; error: string; sources: Source[]; answer: string }> = {
  pt: {
    model: 'mock (sem IA)',
    error: 'Erro simulado pelo modo mock.',
    sources: [
      { title: 'Demon', heading: 'Estratégia', url: 'https://tibia.fandom.com/wiki/Demon' },
      { title: 'Edron Demon Forge', heading: 'Localização', url: 'https://tibia.fandom.com/wiki/Edron_Demon_Forge' },
      { title: 'Bestiary', heading: 'Visão geral', url: 'https://tibia.fandom.com/wiki/Bestiary' }
    ],
    answer: `Ah, jovem aventureiro… vejo que buscas **sabedoria**. Esta é uma resposta de exemplo do modo mock, para você conferir o visual.

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
  },
  en: {
    model: 'mock (no AI)',
    error: 'Error simulated by mock mode.',
    sources: [
      { title: 'Demon', heading: 'Strategy', url: 'https://tibia.fandom.com/wiki/Demon' },
      { title: 'Edron Demon Forge', heading: 'Location', url: 'https://tibia.fandom.com/wiki/Edron_Demon_Forge' },
      { title: 'Bestiary', heading: 'Overview', url: 'https://tibia.fandom.com/wiki/Bestiary' }
    ],
    answer: `Ah, young adventurer… I see you seek **wisdom**. This is a sample answer from mock mode, so you can check the visuals.

### Suggested hunts

| Hunt | Level | Risk |
|------|-------|------|
| Edron Demon Forge | 130+ | high |
| Banuta | 90–130 | moderate |
| Hero Cave | 70–100 | low |

A few tips:

1. Always bring extra **health potions**.
2. Use \`exura gran\` when your health drops below 50%.
3. Avoid fighting *Demons* alone without a good shield.

> Remember: the answer you seek may be closer than you think.

More details on the [TibiaWiki](https://tibia.fandom.com/wiki/Main_Page).`
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Type "erro" or "error" in the question to see how the bubble shows a failure.
export async function sendMockMessage(wc: WebContents, conversationId: string, text: string): Promise<void> {
  const mock = MOCK[getLanguage()]
  await sleep(1200) // "thinking" time, to see the Dungeon Master animation
  if (/erro/i.test(text)) {
    wc.send('chat:done', { conversationId, model: mock.model, error: mock.error })
    return
  }
  wc.send('chat:sources', { conversationId, sources: mock.sources })
  for (const piece of mock.answer.match(/\S+\s*/g) ?? []) {
    if (wc.isDestroyed()) return
    wc.send('chat:delta', { conversationId, text: piece })
    await sleep(35)
  }
  wc.send('chat:done', { conversationId, model: mock.model })
}
