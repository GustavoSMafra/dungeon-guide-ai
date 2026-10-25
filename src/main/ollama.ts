// Minimal client for Ollama's native API (https://github.com/ollama/ollama/blob/main/docs/api.md).

const OLLAMA_URL = 'http://localhost:11434'

// Ollama's default is too small for the wiki excerpts + history.
// 16k fits comfortably in 12 GB of VRAM for ~8B models.
const NUM_CTX = 16384

// Loading the model into VRAM takes ~1 min the first time; it then stays loaded for this long.
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

// Preloads the model (request with no messages) so the first question does not wait for loading.
// Uses the same num_ctx as the chat; a different value would make Ollama reload the model.
export async function warmUp(model: string): Promise<void> {
  await request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } })
  })
}

// Streams the answer; calls onDelta for each text chunk and returns the full text.
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
      // Turns off reasoning mode (Qwen3 etc.): much faster answers.
      think: false,
      keep_alive: KEEP_ALIVE,
      options: { num_ctx: NUM_CTX }
    })
  })

  // The response is NDJSON: one JSON object per line.
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
