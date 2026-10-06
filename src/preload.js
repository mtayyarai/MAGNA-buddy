'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- key management ---
  getKey:        ()  => ipcRenderer.invoke('key:get'),
  saveKey:       (k) => ipcRenderer.invoke('key:save', k),
  clearKey:      ()  => ipcRenderer.invoke('key:clear'),
  testKey:       (k) => ipcRenderer.invoke('key:test', k),
  hasKey:        ()  => ipcRenderer.invoke('key:has'),

  // --- settings ---
  getSettings:         ()  => ipcRenderer.invoke('settings:get'),
  saveSettings:        (s) => ipcRenderer.invoke('settings:save', s),
  onSettingsChanged:   (fn) => ipcRenderer.on('settings:changed', (_, s) => { try { fn(s); } catch {} }),

  // --- shell / window ---
  openExternal:  (u) => ipcRenderer.invoke('shell:openExternal', u),
  closeWindow:   ()  => ipcRenderer.send('window:close'),

  // --- character widget ---
  widgetContextMenu: () => ipcRenderer.send('widget:contextMenu'),
  widgetBeginDrag:   () => ipcRenderer.send('widget:beginDrag'),
  widgetEndDrag:     () => ipcRenderer.send('widget:endDrag'),
  widgetOpenApiKey:  () => ipcRenderer.send('widget:openApiKey'),
  onCursor:          (fn) => {
    ipcRenderer.on('cursor', (_, p) => { try { fn(p); } catch { /* widget renderer */ } });
  },

  // --- talk pipeline (legacy Whisper + Chat path, kept for fallback) ---
  talk:              (payload) => ipcRenderer.invoke('talk', payload),

  // --- Realtime API ---
  realtimeStart:      () => ipcRenderer.invoke('rt:start'),
  realtimeAudioChunk: (buf) => ipcRenderer.send('rt:audio', buf),
  realtimeCommit:     () => ipcRenderer.send('rt:commit'),
  realtimeCancel:     () => ipcRenderer.send('rt:cancel'),

  // --- speech bubble ---
  showBubble:        (data) => ipcRenderer.send('bubble:show', data),
  hideBubble:        ()     => ipcRenderer.send('bubble:hide'),
  onBubble:          (fn) => ipcRenderer.on('bubble:show', (_, d) => { try { fn(d); } catch {} }),
  onBubbleHide:      (fn) => ipcRenderer.on('bubble:hide', () => { try { fn(); } catch {} }),
  bubbleSetIgnore:   (ignore) => ipcRenderer.send('bubble:setIgnore', !!ignore),
  bubbleNavigate:    (dir)    => ipcRenderer.send('bubble:nav', dir),
  bubbleClose:       ()       => ipcRenderer.send('bubble:close'),

  // --- AI cursor overlay ---
  onAiCursorFly:     (fn) => ipcRenderer.on('aicursor:fly', (_, d) => { try { fn(d); } catch {} }),

  // --- Global hotkey ---
  onHotkeyToggleTalk: (fn) => ipcRenderer.on('hotkey:toggleTalk', () => { try { fn(); } catch {} })
});
