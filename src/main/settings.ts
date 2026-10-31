import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { msg } from './messages'
import type { Lang, Provider, SettingsView } from '../shared/types'

interface StoredSettings {
  // API key encrypted with the OS keychain (DPAPI on Windows).
  apiKeyEncrypted?: string
  provider?: Provider
  ollamaModel?: string
  language?: Lang
  judge?: boolean
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
      throw new Error(msg().noEncryption)
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

// Until the player picks one, the app follows the system language.
export function getLanguage(): Lang {
  const s = load()
  if (s.language) return s.language
  return app.getLocale().toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

export function setLanguage(language: Lang): void {
  save({ ...load(), language: language === 'en' ? 'en' : 'pt' })
}

export function getSettingsView(): SettingsView {
  const s = load()
  return {
    hasApiKey: Boolean(s.apiKeyEncrypted) || Boolean(process.env.ANTHROPIC_API_KEY),
    apiKeyFromEnv: !s.apiKeyEncrypted && Boolean(process.env.ANTHROPIC_API_KEY),
    ...getProvider(),
    language: getLanguage(),
    judge: getJudge()
  }
}

// On by default: small local models make things up even with the right data in the context.
export function getJudge(): boolean {
  return load().judge ?? true
}

export function setJudge(on: boolean): void {
  save({ ...load(), judge: on })
}
