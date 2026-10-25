import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import * as characters from './characters'
import { resetConversation, sendMessage } from './chat'
import { ingest, refreshStructured, structuredRefreshNeeded, updateFromDelta } from './rag/ingest'
import type { IngestProgress } from '../shared/types'
import { knowledgeStats } from './rag/search'
import { listModels, warmUp } from './ollama'
import { getProvider, getSettingsView, setApiKey, setProvider } from './settings'
import { MOCK_MODE, sendMockMessage } from './mock'

// In the background; if Ollama is not running, the error only shows when the user asks something.
function warmUpOllama(): void {
  if (MOCK_MODE) return
  const { provider, ollamaModel } = getProvider()
  if (provider === 'ollama') warmUp(ollamaModel).catch(() => {})
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: 'Dungeon Guide AI',
    backgroundColor: '#120e0b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  // Links (wiki sources) open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle('chat:send', (e, conversationId: string, text: string, characterId: number | null) => {
    // Returns immediately; the content arrives through chat:delta / chat:done events.
    if (MOCK_MODE) void sendMockMessage(e.sender, conversationId, text)
    else void sendMessage(e.sender, conversationId, text, characterId)
  })
  ipcMain.handle('chat:reset', (_e, conversationId: string) => resetConversation(conversationId))

  ipcMain.handle('characters:list', () => characters.listCharacters())
  ipcMain.handle('characters:add', (_e, name: string) => characters.addCharacter(name))
  ipcMain.handle('characters:sync', (_e, id: number) => characters.syncCharacter(id))
  ipcMain.handle('characters:remove', (_e, id: number) => characters.removeCharacter(id))
  ipcMain.handle('characters:saveNotes', (_e, id: number, notes: string) => characters.saveNotes(id, notes))
  ipcMain.handle('characters:setPremiumOverride', (_e, id: number, premium: boolean | null) =>
    characters.setPremiumOverride(id, premium)
  )
  ipcMain.handle('characters:setSkills', (_e, id: number, skills) => characters.setSkills(id, skills))
  ipcMain.handle('characters:setPortrait', (_e, id: number, dataUrl: string | null) =>
    characters.setPortrait(id, dataUrl)
  )
  ipcMain.handle('characters:levelHistory', (_e, id: number) => characters.levelHistory(id))
  ipcMain.handle('characters:progress', (_e, id: number) => characters.listProgress(id))
  ipcMain.handle('characters:addProgress', (_e, characterId, kind, title) =>
    characters.addProgress(characterId, kind, title)
  )
  ipcMain.handle('characters:setProgressStatus', (_e, id, status) => characters.setProgressStatus(id, status))
  ipcMain.handle('characters:removeProgress', (_e, id: number) => characters.removeProgress(id))

  ipcMain.handle('knowledge:stats', () => knowledgeStats())
  ipcMain.handle('knowledge:ingest', (e, categories: string[], max: number | null) =>
    ingest(categories, max, (p) => e.sender.send('knowledge:progress', p))
  )
  ipcMain.handle('knowledge:update', (e) => updateFromDelta((p) => e.sender.send('knowledge:progress', p)))

  ipcMain.handle('settings:get', () => getSettingsView())
  ipcMain.handle('settings:setApiKey', (_e, key: string) => setApiKey(key))
  ipcMain.handle('settings:setProvider', (_e, provider, ollamaModel: string) => {
    setProvider(provider, ollamaModel)
    warmUpOllama()
  })
  ipcMain.handle('settings:ollamaModels', () => listModels())
}

app.whenReady().then(() => {
  registerIpc()
  const win = createWindow()
  warmUpOllama()

  // After a parser update, repopulate hunts/creatures in the background.
  if (!MOCK_MODE && structuredRefreshNeeded()) {
    const send = (p: IngestProgress): void => {
      if (!win.isDestroyed()) win.webContents.send('knowledge:progress', p)
    }
    refreshStructured((done, total) =>
      send({ phase: 'fetching', done, total, message: 'Atualizando dados de hunts e criaturas…' })
    )
      .then(() => send({ phase: 'done', done: 1, total: 1, message: 'Dados de hunts e criaturas atualizados!' }))
      .catch((err: Error) => send({ phase: 'error', done: 0, total: 0, message: err.message }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
