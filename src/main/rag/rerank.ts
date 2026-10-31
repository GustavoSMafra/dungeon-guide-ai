import { app } from 'electron'
import { join } from 'path'

// Multilingual cross-encoder (trained on mMARCO, which includes Portuguese): reads the question and each
// excerpt together and scores how well the excerpt answers it. Unlike the embedding similarity, its score
// separates relevant from unrelated excerpts well enough to drop the unrelated ones (see search.ts).
// Downloaded from Hugging Face on first use (~120 MB, int8) and cached in userData/models.
const MODEL = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'
// The repo ships its int8 build under this name instead of the transformers.js default.
const MODEL_FILE = 'model_quint8_avx2'
// Excerpts are up to ~1,200 characters; 384 tokens covers them and keeps CPU time down.
const MAX_TOKENS = 384

interface Tokenizer {
  (text: string[], opts: { text_pair: string[]; padding: boolean; truncation: boolean; max_length: number }): unknown
}
type Model = (inputs: unknown) => Promise<{ logits: { data: Float32Array } }>

let loading: Promise<{ tokenizer: Tokenizer; model: Model }> | null = null

function load(): Promise<{ tokenizer: Tokenizer; model: Model }> {
  if (!loading) {
    loading = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers')
      env.cacheDir = join(app.getPath('userData'), 'models')
      const tokenizer = (await AutoTokenizer.from_pretrained(MODEL)) as unknown as Tokenizer
      const model = (await AutoModelForSequenceClassification.from_pretrained(MODEL, {
        model_file_name: MODEL_FILE,
        dtype: 'fp32'
      })) as unknown as Model
      return { tokenizer, model }
    })()
    loading.catch(() => (loading = null))
  }
  return loading
}

// Relevance logits, one per text (higher = more relevant; roughly -10..10).
export async function rerank(query: string, texts: string[]): Promise<number[]> {
  if (!texts.length) return []
  const { tokenizer, model } = await load()
  const inputs = tokenizer(
    texts.map(() => query),
    { text_pair: texts, padding: true, truncation: true, max_length: MAX_TOKENS }
  )
  const { logits } = await model(inputs)
  return Array.from(logits.data)
}

// Loads the model in the background so the first question does not wait for it.
export function warmUpReranker(): void {
  load().catch(() => {})
}
