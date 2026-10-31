import { app } from 'electron'
import { join } from 'path'

// Multilingual models: questions in Brazilian Portuguese match English wiki excerpts.
// Downloaded from Hugging Face on first use and cached in userData/models.
interface EmbeddingModel {
  id: string
  dim: number
  dtype: 'q8' | 'q4' | 'fp32'
  query: string
  passage: string
}

const MODELS: Record<string, EmbeddingModel> = {
  // ~120 MB. e5 expects the "query: " and "passage: " prefixes.
  e5: { id: 'Xenova/multilingual-e5-small', dim: 384, dtype: 'q8', query: 'query: ', passage: 'passage: ' },
  // ~200 MB (q4). Its own task prompts; produces `sentence_embedding` directly.
  gemma: {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    dim: 768,
    dtype: 'q4',
    query: 'task: search result | query: ',
    passage: 'title: none | text: '
  }
}

// DGA_EMBEDDING switches the model for experiments (npm run eval on a copy indexed with it). Changing the
// default needs a full re-index: bump INDEX_SCHEMA in db.ts.
const MODEL = MODELS[process.env.DGA_EMBEDDING ?? ''] ?? MODELS.e5
export const EMBEDDING_DIM = MODEL.dim

type Embedder = (texts: string[]) => Promise<Float32Array[]>

let embedder: Promise<Embedder> | null = null

function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    embedder = (async (): Promise<Embedder> => {
      const transformers = await import('@huggingface/transformers')
      transformers.env.cacheDir = join(app.getPath('userData'), 'models')
      if (MODEL.id.includes('embeddinggemma')) {
        const tokenizer = await transformers.AutoTokenizer.from_pretrained(MODEL.id)
        const model = await transformers.AutoModel.from_pretrained(MODEL.id, { dtype: MODEL.dtype })
        return async (texts) => {
          const inputs = tokenizer(texts, { padding: true, truncation: true })
          const { sentence_embedding } = (await model(inputs)) as { sentence_embedding: { data: Float32Array } }
          return split(sentence_embedding.data, texts.length).map(normalize)
        }
      }
      const extractor = await transformers.pipeline('feature-extraction', MODEL.id, { dtype: MODEL.dtype })
      return async (texts) => {
        const out = (await extractor(texts, { pooling: 'mean', normalize: true })) as unknown as { data: Float32Array }
        return split(out.data, texts.length)
      }
    })()
    embedder.catch(() => (embedder = null))
  }
  return embedder
}

function split(data: Float32Array, n: number): Float32Array[] {
  const d = data.length / n
  return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d))
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}

export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  const run = await getEmbedder()
  const prefix = kind === 'query' ? MODEL.query : MODEL.passage
  return run(texts.map((t) => prefix + t))
}
