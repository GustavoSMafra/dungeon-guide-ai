import { app } from 'electron'
import { join } from 'path'

// Multilingual model: questions in Brazilian Portuguese match English wiki excerpts.
// Downloaded from Hugging Face on first use (~120 MB) and cached in userData/models.
const MODEL = 'Xenova/multilingual-e5-small'
export const EMBEDDING_DIM = 384

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

let extractor: Promise<Extractor> | null = null

function getExtractor(): Promise<Extractor> {
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = join(app.getPath('userData'), 'models')
      return (await pipeline('feature-extraction', MODEL, { dtype: 'q8' })) as unknown as Extractor
    })()
    extractor.catch(() => (extractor = null))
  }
  return extractor
}

// e5 expects the "query: " and "passage: " prefixes.
export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  const ex = await getExtractor()
  const out = await ex(
    texts.map((t) => `${kind}: ${t}`),
    { pooling: 'mean', normalize: true }
  )
  const [n, d] = out.dims
  return Array.from({ length: n }, (_, i) => out.data.slice(i * d, (i + 1) * d))
}
