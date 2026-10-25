import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  chat: {
    send: (conversationId, text, characterId) => ipcRenderer.invoke('chat:send', conversationId, text, characterId),
    reset: (conversationId) => ipcRenderer.invoke('chat:reset', conversationId),
    onDelta: (cb) => on('chat:delta', cb),
    onSources: (cb) => on('chat:sources', cb),
    onDone: (cb) => on('chat:done', cb)
  },
  characters: {
    list: () => ipcRenderer.invoke('characters:list'),
    add: (name) => ipcRenderer.invoke('characters:add', name),
    sync: (id) => ipcRenderer.invoke('characters:sync', id),
    remove: (id) => ipcRenderer.invoke('characters:remove', id),
    saveNotes: (id, notes) => ipcRenderer.invoke('characters:saveNotes', id, notes),
    setPremiumOverride: (id, premium) => ipcRenderer.invoke('characters:setPremiumOverride', id, premium),
    setSkills: (id, skills) => ipcRenderer.invoke('characters:setSkills', id, skills),
    setPortrait: (id, dataUrl) => ipcRenderer.invoke('characters:setPortrait', id, dataUrl),
    levelHistory: (id) => ipcRenderer.invoke('characters:levelHistory', id),
    progress: (id) => ipcRenderer.invoke('characters:progress', id),
    addProgress: (characterId, kind, title) => ipcRenderer.invoke('characters:addProgress', characterId, kind, title),
    setProgressStatus: (id, status) => ipcRenderer.invoke('characters:setProgressStatus', id, status),
    removeProgress: (id) => ipcRenderer.invoke('characters:removeProgress', id)
  },
  knowledge: {
    stats: () => ipcRenderer.invoke('knowledge:stats'),
    ingest: (categories, max) => ipcRenderer.invoke('knowledge:ingest', categories, max),
    update: () => ipcRenderer.invoke('knowledge:update'),
    onProgress: (cb) => on('knowledge:progress', cb)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
    setProvider: (provider, ollamaModel) => ipcRenderer.invoke('settings:setProvider', provider, ollamaModel),
    ollamaModels: () => ipcRenderer.invoke('settings:ollamaModels')
  }
}

contextBridge.exposeInMainWorld('api', api)
