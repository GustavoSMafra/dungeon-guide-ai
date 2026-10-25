// Cliente mínimo da API nativa do Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md).

const OLLAMA_URL = 'http://localhost:11434'

// O padrão do Ollama é pequeno demais para os trechos da wiki + histórico.
// 16k cabe com folga em 12 GB de VRAM para modelos de ~8B.
const NUM_CTX = 16384

// Carregar o modelo na VRAM leva ~1 min na primeira vez; depois ele fica carregado por este tempo.
const KEEP_ALIVE = '30m'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${OLLAMA_URL}${path}`, init)
  } catch {
    throw new Error('Não consegui falar com o Ollama em localhost:11434. Ele está aberto?')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(`Ollama: ${body.error ?? `erro ${res.status}`}`)
  }
  return res
}

export async function listModels(): Promise<string[]> {
  const res = await request('/api/tags')
  const body = (await res.json()) as { models: { name: string }[] }
  return body.models.map((m) => m.name).sort()
}

// Pré-carrega o modelo (pedido sem mensagens) para a primeira pergunta não esperar o carregamento.
// Usa o mesmo num_ctx do chat; com outro valor o Ollama recarregaria o modelo.
export async function warmUp(model: string): Promise<void> {
  await request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } })
  })
}

// Faz streaming da resposta; chama onDelta a cada pedaço de texto e devolve o texto completo.
export async function streamChat(
  model: string,
  messages: OllamaMessage[],
  onDelta: (text: string) => void
): Promise<string> {
  const res = await request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      // Desliga o modo de raciocínio (Qwen3 etc.): respostas bem mais rápidas.
      think: false,
      keep_alive: KEEP_ALIVE,
      options: { num_ctx: NUM_CTX }
    })
  })

  // A resposta é NDJSON: um objeto JSON por linha.
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string }
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
      const text = chunk.message?.content
      if (text) {
        full += text
        onDelta(text)
      }
    }
  }
  return full
}
