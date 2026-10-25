import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Provider, SettingsView } from '../shared/types'

interface StoredSettings {
  // Chave da API criptografada com o cofre do sistema operacional (DPAPI no Windows).
  apiKeyEncrypted?: string
  provider?: Provider
  ollamaModel?: string
}

export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b'

const file = (): string => join(app.getPath('userData'), 'settings.json')

function load(): StoredSettings {
  if (!existsSync(file())) return {}
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as StoredSettings
  } catch {
    return {}
  }
}

function save(s: StoredSettings): void {
  writeFileSync(file(), JSON.stringify(s, null, 2))
}

export function getApiKey(): string | null {
  const s = load()
  if (s.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted, 'base64'))
  }
  return process.env.ANTHROPIC_API_KEY ?? null
}

export function setApiKey(key: string): void {
  const s = load()
  const trimmed = key.trim()
  if (!trimmed) {
    delete s.apiKeyEncrypted
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Criptografia do sistema indisponível; defina ANTHROPIC_API_KEY no ambiente.')
    }
    s.apiKeyEncrypted = safeStorage.encryptString(trimmed).toString('base64')
  }
  save(s)
}

export function getProvider(): { provider: Provider; ollamaModel: string } {
  const s = load()
  return { provider: s.provider ?? 'claude', ollamaModel: s.ollamaModel ?? DEFAULT_OLLAMA_MODEL }
}

export function setProvider(provider: Provider, ollamaModel: string): void {
  save({ ...load(), provider, ollamaModel: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL })
}

export function getSettingsView(): SettingsView {
  const s = load()
  return {
    hasApiKey: Boolean(s.apiKeyEncrypted) || Boolean(process.env.ANTHROPIC_API_KEY),
    apiKeyFromEnv: !s.apiKeyEncrypted && Boolean(process.env.ANTHROPIC_API_KEY),
    ...getProvider()
  }
}
