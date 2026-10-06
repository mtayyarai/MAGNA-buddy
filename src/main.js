'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, safeStorage, shell, dialog, Notification, screen, session
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');

// Allow procedural chirps to play from the cursor + bubble renderers (which
// never receive a user gesture).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Single-instance guard — a second launch focuses the running tray.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  startApp();
}

function startApp() {
  let tray = null;
  let apiKeyWin = null;
  let settingsWin = null;
  let widgetWin = null;
  let bubbleWin = null;
  let aiCursorWin = null;
  let bubbleHideTimer = null;
  let dragInterval = null;
  let cursorTimer = null;
  let LOG_FILE = null;

  const userData = (name) => path.join(app.getPath('userData'), name);
  const keyPath = () => userData('keys.bin');
  const settingsPath = () => userData('settings.json');

  // --------- logging ---------
  function initLog() {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    LOG_FILE = path.join(dir, `app-${new Date().toISOString().slice(0, 10)}.log`);
  }
  const log = (level, msg) => {
    try {
      if (!LOG_FILE) return;
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${msg}\n`);
    } catch { /* logging must never crash */ }
  };
  const info = (m) => log('INFO', m);
  const errLog = (m) => log('ERROR', m);

  // --------- settings ---------
  const defaults = {
    useRealtime: true,
    realtimeModel: 'gpt-realtime-2.1-mini',
    transcribeModel: 'whisper-1',
    chatModel: 'gpt-4o-mini',
    researchModel: 'gpt-5.5',
    personality:
      "You are a cheerful googly-eyed companion who lives on the user's screen. " +
      "Keep replies to one or two short sentences. Never speak unless asked. " +
      "Use tools to look at the screen, point to things, do research, or help with the computer.",
    homePosition: 'right',
    cursorSize: 72,
    captions: true,
    followMouse: true,
    allowComputerUse: true,
    startWithWindows: false,
    showWidget: true,
    widgetSize: 90,
    customWidgetX: null,
    customWidgetY: null,
    hotkeys: {
      Point: 'Ctrl+Alt+P',
      Follow: 'Ctrl+Alt+F',
      Home: 'Ctrl+Alt+D',
      TalkTest: 'Ctrl+Alt+T',
      Hide: 'Ctrl+Alt+H',
      Wake: 'Ctrl+Alt+Space',
      Stop: 'Ctrl+Alt+S',
      PushToTalk: 'RightCtrl'
    }
  };

  function loadSettings() {
    try {
      const p = settingsPath();
      if (fs.existsSync(p)) {
        let raw = fs.readFileSync(p, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
      }
    } catch (e) {
      errLog(`settings load: ${e.message}`);
    }
    return { ...defaults };
  }

  function saveSettings(s) {
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
      applyStartupSetting(!!s.startWithWindows);
      info('settings saved');
      return true;
    } catch (e) {
      errLog(`settings save: ${e.message}`);
      return false;
    }
  }

  function applyStartupSetting(enable) {
    // Only meaningful for packaged builds. In dev `process.execPath` is electron.exe.
    if (!app.isPackaged) return;
    try {
      app.setLoginItemSettings({ openAtLogin: enable, path: process.execPath });
    } catch (e) {
      errLog(`startup toggle: ${e.message}`);
    }
  }

  // --------- secrets (DPAPI via Electron safeStorage) ---------
  function readKey() {
    try {
      const p = keyPath();
      if (!fs.existsSync(p)) return null;
      if (!safeStorage.isEncryptionAvailable()) {
        errLog('safeStorage not available on this OS user');
        return null;
      }
      return safeStorage.decryptString(fs.readFileSync(p));
    } catch (e) {
      errLog(`secret read: ${e.message}`);
      return null;
    }
  }

  function writeKey(k) {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        errLog('safeStorage not available — cannot encrypt key');
        return false;
      }
      fs.writeFileSync(keyPath(), safeStorage.encryptString(k));
      info('key saved');
      return true;
    } catch (e) {
      errLog(`secret write: ${e.message}`);
      return false;
    }
  }

  function clearKey() {
    try {
      if (fs.existsSync(keyPath())) fs.unlinkSync(keyPath());
      info('key cleared');
      return true;
    } catch (e) {
      errLog(`secret clear: ${e.message}`);
      return false;
    }
  }

  const hasKey = () => fs.existsSync(keyPath());

  // --------- OpenAI test call ---------
  function testOpenAIKey(apiKey) {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: 'GET',
          hostname: 'api.openai.com',
          path: '/v1/models',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'GooglyEyes/0.1'
          },
          timeout: 12000
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            if (body.length < 400) body += chunk.toString('utf8');
          });
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              body: body.slice(0, 400)
            });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
      req.end();
    });
  }

  // --------- windows ---------
  function winCommonOptions() {
    return {
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#fafafa',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    };
  }

  function createApiKeyWindow() {
    if (apiKeyWin) { apiKeyWin.focus(); return; }
    apiKeyWin = new BrowserWindow({
      ...winCommonOptions(),
      width: 580,
      height: 400,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'OpenAI API Key — MAGNA Buddy'
    });
    apiKeyWin.setMenuBarVisibility(false);
    apiKeyWin.once('ready-to-show', () => apiKeyWin.show());
    apiKeyWin.loadFile(path.join(__dirname, 'renderer', 'apiKey.html'));
    apiKeyWin.on('closed', () => { apiKeyWin = null; });
  }

  function createSettingsWindow() {
    if (settingsWin) { settingsWin.focus(); return; }
    settingsWin = new BrowserWindow({
      ...winCommonOptions(),
      width: 640,
      height: 720,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: 'Settings — MAGNA Buddy'
    });
    settingsWin.setMenuBarVisibility(false);
    settingsWin.once('ready-to-show', () => settingsWin.show());
    settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
    settingsWin.on('closed', () => { settingsWin = null; });
  }

  // --------- character widget ---------
  function widgetBoundsForSettings(s) {
    const size = Math.max(60, Math.min(260, s.widgetSize || 90));

    // Custom drag position wins over homePosition. Clamp to whichever display
    // contains the saved point.
    if (typeof s.customWidgetX === 'number' && typeof s.customWidgetY === 'number') {
      const probe = { x: s.customWidgetX, y: s.customWidgetY, width: size, height: size };
      const { workArea } = screen.getDisplayMatching(probe);
      const x = Math.max(workArea.x, Math.min(workArea.x + workArea.width - size, s.customWidgetX));
      const y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - size, s.customWidgetY));
      return { x, y, width: size, height: size };
    }

    const primary = screen.getPrimaryDisplay().workArea;
    const margin = 16;
    let x;
    if (s.homePosition === 'left') {
      x = primary.x + margin;
    } else if (s.homePosition === 'center') {
      x = primary.x + Math.floor((primary.width - size) / 2);
    } else {
      x = primary.x + primary.width - size - margin;
    }
    const y = primary.y + primary.height - size - margin;
    return { x, y, width: size, height: size };
  }

  function createWidgetWindow() {
    if (widgetWin && !widgetWin.isDestroyed()) {
      widgetWin.show();
      return;
    }
    const s = loadSettings();
    const b = widgetBoundsForSettings(s);

    widgetWin = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      type: 'toolbar',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    widgetWin.setAlwaysOnTop(true, 'screen-saver');
    widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    widgetWin.setMenuBarVisibility(false);
    widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
    widgetWin.once('ready-to-show', () => widgetWin.showInactive());
    widgetWin.on('closed', () => { widgetWin = null; });

    startCursorPump();
  }

  function hideWidget() {
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
    stopCursorPump();
  }

  function toggleWidget() {
    const isShowing = !!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible());
    if (isShowing) hideWidget();
    else createWidgetWindow();
    const s = loadSettings();
    s.showWidget = !isShowing;
    saveSettings(s);
    refreshTrayMenu();
  }

  function repositionWidget() {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const s = loadSettings();
    const b = widgetBoundsForSettings(s);
    widgetWin.setBounds(b);
  }

  function startCursorPump() {
    if (cursorTimer) return;
    cursorTimer = setInterval(() => {
      if (!widgetWin || widgetWin.isDestroyed() || !widgetWin.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      const b = widgetWin.getBounds();
      const wx = b.x + b.width / 2;
      const wy = b.y + b.height / 2;
      widgetWin.webContents.send('cursor', { x: p.x, y: p.y, wx, wy });
    }, 60); // ~16 Hz; cheap, enough for pupil smoothing
  }

  function stopCursorPump() {
    if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
  }

  // --------- speech bubble history ---------
  // bubbleItems is a rolling list of past replies. The user can click the
  // left/right arrows in the bubble to walk through history. The bubble
  // stays visible until the user dismisses it with the × button, or until a
  // new reply replaces the display.
  const bubbleItems = [];
  const BUBBLE_HISTORY_MAX = 30;
  let bubbleCursor = -1; // index of currently-displayed item (-1 = none)

  function addToBubbleHistory(item) {
    bubbleItems.push({ ...item, ts: Date.now() });
    while (bubbleItems.length > BUBBLE_HISTORY_MAX) bubbleItems.shift();
    bubbleCursor = bubbleItems.length - 1;
    const cur = bubbleItems[bubbleCursor];
    showBubble(cur.reply, cur.user, {
      historyIndex: bubbleCursor,
      historyCount: bubbleItems.length
    });
  }

  function showBubbleAt(idx) {
    if (bubbleItems.length === 0) return;
    bubbleCursor = Math.max(0, Math.min(bubbleItems.length - 1, idx));
    const cur = bubbleItems[bubbleCursor];
    showBubble(cur.reply, cur.user, {
      historyIndex: bubbleCursor,
      historyCount: bubbleItems.length
    });
  }

  // --------- speech bubble (separate transparent window) ---------
  function showBubble(reply, userText, meta) {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const widgetBounds = widgetWin.getBounds();
    const words = String(reply || '').split(/\s+/).filter(Boolean).length;

    const BW = Math.max(300, Math.min(400, 220 + words * 10));
    const BH = Math.max(140, Math.min(260, 130 + words * 3));

    const display = screen.getDisplayMatching(widgetBounds).workArea;
    let x = widgetBounds.x + Math.floor(widgetBounds.width / 2) - Math.floor(BW / 2);
    let y = widgetBounds.y - BH - 12;
    if (y < display.y + 4) y = widgetBounds.y + widgetBounds.height + 12;
    x = Math.max(display.x + 4, Math.min(display.x + display.width - BW - 4, x));

    const bounds = { x, y, width: BW, height: BH };

    const payload = {
      reply,
      user: userText,
      historyIndex: meta?.historyIndex ?? -1,
      historyCount: meta?.historyCount ?? 0
    };

    if (!bubbleWin || bubbleWin.isDestroyed()) {
      bubbleWin = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        focusable: true,
        show: false,
        backgroundColor: '#00000000',
        type: 'toolbar',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      bubbleWin.setAlwaysOnTop(true, 'screen-saver');
      bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      bubbleWin.setIgnoreMouseEvents(true, { forward: true });
      bubbleWin.setMenuBarVisibility(false);
      bubbleWin.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
      bubbleWin.on('closed', () => { bubbleWin = null; });
      bubbleWin.webContents.once('did-finish-load', () => {
        if (!bubbleWin || bubbleWin.isDestroyed()) return;
        bubbleWin.setBounds(bounds);
        bubbleWin.showInactive();
        bubbleWin.webContents.send('bubble:show', payload);
      });
    } else {
      bubbleWin.setBounds(bounds);
      if (!bubbleWin.isVisible()) bubbleWin.showInactive();
      bubbleWin.webContents.send('bubble:show', payload);
    }

    // Sticky — no auto-hide. User dismisses with × button in the renderer.
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
  }

  function hideBubbleSoon(delay) {
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
    bubbleHideTimer = setTimeout(() => {
      if (bubbleWin && !bubbleWin.isDestroyed()) {
        bubbleWin.webContents.send('bubble:hide');
        setTimeout(() => {
          if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
        }, 220);
      }
    }, delay);
  }

  function hideBubble() {
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }

  // --------- talk pipeline (Whisper -> Chat Completions w/ tools) ---------
  async function talkTranscribeAndChat(payload) {
    try {
      const key = readKey();
      if (!key) {
        return { error: 'No OpenAI key saved — right-click the character → OpenAI Key…' };
      }
      const s = loadSettings();
      const audioBuf = payload?.audioBuf;
      const mimeType = payload?.mimeType || 'audio/webm';
      if (!audioBuf || audioBuf.byteLength < 500) return { error: '(too short)' };

      // --- 1. Transcription ---
      const form = new FormData();
      const blob = new Blob([audioBuf], { type: mimeType });
      const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
      form.append('file', blob, `audio.${ext}`);
      form.append('model', s.transcribeModel || 'whisper-1');

      const trCtl = new AbortController();
      const trTimer = setTimeout(() => trCtl.abort(), 30_000);
      let tr;
      try {
        tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: trCtl.signal
        });
      } finally { clearTimeout(trTimer); }
      if (!tr.ok) {
        const t = await tr.text().catch(() => '');
        errLog(`transcribe ${tr.status}: ${t.slice(0, 200)}`);
        return { error: `Transcription failed (${tr.status})` };
      }
      const userText = ((await tr.json()).text || '').trim();
      if (!userText) {
        return { user: '', reply: "(didn't catch that — try holding longer and speaking clearly)" };
      }

      // --- 2. Chat completion with tool-calling loop ---
      const allowCompute = s.allowComputerUse !== false;
      const tools = allowCompute ? toolSchemas() : [];
      const messages = [
        {
          role: 'system',
          content:
            (s.personality || '') +
            (allowCompute
              ? '\n\nYou can take actions on this Windows PC with the provided tools. When the user asks to open a website, use open_url. For installed apps use open_app. For typing use type_text. For keyboard shortcuts use press_keys. Only act when asked. Keep spoken replies to one short sentence.'
              : '\n\nComputer-use is disabled; just respond with text.')
        },
        { role: 'user', content: userText }
      ];

      const actionsPerformed = [];
      let finalText = '';

      for (let iter = 0; iter < 6; iter++) {
        const chatCtl = new AbortController();
        const chatTimer = setTimeout(() => chatCtl.abort(), 60_000);
        let ch;
        try {
          ch = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: s.chatModel || 'gpt-4o-mini',
              messages,
              tools: tools.length ? tools : undefined,
              tool_choice: tools.length ? 'auto' : undefined,
              max_tokens: 300,
              temperature: 0.5
            }),
            signal: chatCtl.signal
          });
        } finally { clearTimeout(chatTimer); }

        if (!ch.ok) {
          const t = await ch.text().catch(() => '');
          errLog(`chat ${ch.status}: ${t.slice(0, 200)}`);
          return { user: userText, error: `Chat failed (${ch.status})` };
        }
        const chJson = await ch.json();
        const msg = chJson.choices?.[0]?.message;
        if (!msg) {
          return { user: userText, error: 'empty response' };
        }
        messages.push(msg);

        const toolCalls = msg.tool_calls || [];
        if (toolCalls.length === 0) {
          finalText = (msg.content || '').trim();
          break;
        }

        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
          const toolName = tc.function?.name;
          notifyBubbleStatus(toolStatusText(toolName, args));
          const res = await executeTool(toolName, args);
          actionsPerformed.push(`${toolName}(${JSON.stringify(args).slice(0, 60)})`);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(res).slice(0, 400)
          });
        }
      }

      if (!finalText) {
        finalText = actionsPerformed.length
          ? 'Done.'
          : '(no reply)';
      }
      return { user: userText, reply: finalText, actions: actionsPerformed };
    } catch (e) {
      errLog(`talk pipeline: ${e.message}`);
      return { error: e.message || 'talk failed' };
    }
  }

  function notifyBubbleStatus(text) {
    if (!text) return;
    showBubble(text, '');
  }

  // ========================================================================
  // Realtime API session (WebSocket, text-only output, tool calls)
  // ========================================================================
  // One session per press-and-hold. On release we commit the audio buffer and
  // ask for a response; after `response.done` (or error) we close the socket.
  //
  //   renderer                       main                       OpenAI
  //   --------                       ----                       ------
  //   realtime:start   ───────▶  openRealtime()  ──ws─▶  session.update
  //   realtime:audio   ───────▶  send input_audio_buffer.append
  //   realtime:commit  ───────▶  send input_audio_buffer.commit + response.create
  //   realtime:cancel  ───────▶  close socket
  //   bubble:show      ◀──────   stream text deltas / final text / errors
  //   tool executors   ◀──────   function_call_arguments.done
  // ========================================================================

  let rt = null;
  let rtTranscript = '';
  let rtAssistant = '';
  let rtPendingToolCalls = {}; // call_id -> { name, argumentsText }
  let rtClosing = false;
  let rtChunksSent = 0; // audio chunks forwarded this session

  function closeRealtime(reason) {
    if (!rt) return;
    rtClosing = true;
    try { rt.close(1000, reason || 'done'); } catch {}
    rt = null;
    rtPendingToolCalls = {};
  }

  function sendRt(obj) {
    if (!rt || rt.readyState !== 1) return false;
    try { rt.send(JSON.stringify(obj)); return true; } catch (e) {
      errLog(`rt send: ${e.message}`); return false;
    }
  }

  async function openRealtime() {
    const key = readKey();
    if (!key) {
      showBubble('No OpenAI key saved — right-click the character → OpenAI Key…', '');
      return false;
    }
    if (rt) { closeRealtime('restart'); }
    rtClosing = false;
    rtTranscript = '';
    rtAssistant = '';
    rtPendingToolCalls = {};
    rtChunksSent = 0;

    const s = loadSettings();
    const model = s.realtimeModel || 'gpt-realtime-2.1-mini';
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    try {
      // GA Realtime API: no OpenAI-Beta header (the beta header was retired).
      let socket;
      try {
        const ws = require('ws');
        socket = new ws(url, {
          headers: { Authorization: `Bearer ${key}` }
        });
      } catch {
        const undici = require('undici');
        socket = new undici.WebSocket(url, {
          headers: { Authorization: `Bearer ${key}` }
        });
      }
      rt = socket;
    } catch (e) {
      errLog(`rt open: ${e.message}`);
      showBubble(`Realtime connection failed: ${e.message}`, '');
      return false;
    }

    // Wait for the socket to actually open before returning so the renderer
    // knows audio chunks sent afterwards will reach the server.
    try {
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timeout connecting')), 8000);
        rt.onopen  = () => { clearTimeout(to); resolve(); };
        rt.onerror = (e) => { clearTimeout(to); reject(new Error(e?.message || 'ws error')); };
      });
    } catch (e) {
      errLog(`rt connect: ${e.message}`);
      showBubble(`Realtime: ${e.message}`, '');
      try { rt.close(); } catch {}
      rt = null;
      return false;
    }

    info('rt open');

    // Permanent handlers
    rt.onmessage = async (ev) => {
      let evt;
      try { evt = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString('utf8')); }
      catch { return; }
      await handleRealtimeEvent(evt);
    };
    rt.onerror = (e) => { errLog(`rt error: ${e?.message || 'ws error'}`); };
    rt.onclose = (e) => {
      info(`rt close ${e?.code || ''} ${e?.reason || ''}`);
      rt = null;
      if (!rtClosing && !rtAssistant) {
        if (e?.code && e.code !== 1000) {
          showBubble(`Realtime closed (${e.code}) ${e.reason || ''}`.trim(), '');
        }
      }
    };

    // Configure session (GA shape — session.type: "realtime", output_modalities,
    // audio.input.{format,transcription,turn_detection}).
    const s2 = loadSettings();
    const tools = (s2.allowComputerUse !== false) ? realtimeTools() : [];
    sendRt({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: (s2.personality || '') + (tools.length
          ? [
              '',
              '',
              'You can take actions on this Windows PC with the provided tools.',
              'Rules for multi-step tasks (always follow in order):',
              '  1. For a search on YouTube / Google / Amazon / Reddit / etc, call web_search — DO NOT call open_url + type_text separately.',
              '  2. To type into any webpage (ChatGPT, Twitter, Notion, Gmail, …): first call open_url, then call wait with ms=3500 (give the page time to load and auto-focus its input), then type_text, then (if needed) press_keys with keys="enter".',
              '  3. To use an installed app: open_app, then wait with ms=1500, then type_text / press_keys.',
              '  4. You can call multiple tools in one response — the client will execute them in order and then ask you to continue.',
              '  5. Only act when the user asks. Never type or press keys unless explicitly instructed. Refuse Win+L / Ctrl+Alt+Del / Ctrl+Shift+Esc.',
              '  6. Keep spoken replies to one short sentence.'
            ].join('\n')
          : ''),
        output_modalities: ['text'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: s2.transcribeModel || 'whisper-1' },
            turn_detection: null
          }
        },
        tools,
        tool_choice: tools.length ? 'auto' : 'none'
      }
    });

    return true;
  }

  async function handleRealtimeEvent(evt) {
    const t = evt.type;
    switch (t) {
      case 'session.created':
      case 'session.updated':
        break;
      case 'conversation.item.input_audio_transcription.completed':
        rtTranscript = (evt.transcript || '').trim();
        // Not shown alone — kept so we can display it with the eventual reply.
        break;
      case 'response.output_text.delta':
      case 'response.text.delta': {
        rtAssistant += evt.delta || '';
        showBubble(rtAssistant, rtTranscript);
        break;
      }
      case 'response.output_text.done':
      case 'response.text.done': {
        if (evt.text) {
          rtAssistant = evt.text;
          showBubble(rtAssistant, rtTranscript);
        }
        break;
      }
      case 'response.function_call_arguments.delta': {
        const slot = rtPendingToolCalls[evt.call_id] || {};
        slot.argumentsText = (slot.argumentsText || '') + (evt.delta || '');
        rtPendingToolCalls[evt.call_id] = slot;
        break;
      }
      case 'response.function_call_arguments.done': {
        // Queue the tool call — don't execute until response.done so we can
        // run multiple tool calls (one response) in a single batch and avoid
        // racing new response.create requests against in-flight tool_calls.
        const slot = rtPendingToolCalls[evt.call_id] || {};
        slot.argumentsText = evt.arguments || slot.argumentsText || '{}';
        slot.name = evt.name || slot.name;
        rtPendingToolCalls[evt.call_id] = slot;
        break;
      }
      case 'response.done': {
        const pending = Object.entries(rtPendingToolCalls);
        if (pending.length > 0) {
          // Execute every queued tool, send all outputs, then ask the model
          // to continue (which may be another tool step or the final text).
          for (const [callId, slot] of pending) {
            let args = {};
            try { args = JSON.parse(slot.argumentsText || '{}'); } catch {}
            notifyBubbleStatus(toolStatusText(slot.name, args));
            const res = await executeTool(slot.name, args);
            sendRt({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(res).slice(0, 400)
              }
            });
          }
          rtPendingToolCalls = {};
          rtAssistant = ''; // reset buffer for the next response's text
          sendRt({ type: 'response.create', response: { output_modalities: ['text'] } });
          break;
        }

        // No more pending tool calls — this is the terminal response.
        const finalText = evt.response?.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'text')?.text;
        if (finalText && finalText.trim()) {
          rtAssistant = finalText.trim();
        }
        if (rtAssistant || rtTranscript) {
          addToBubbleHistory({ user: rtTranscript, reply: rtAssistant });
        }
        closeRealtime('response done');
        break;
      }
      case 'error': {
        const msg = evt.error?.message || 'realtime error';
        errLog(`rt event error: ${msg}`);
        showBubble(`Realtime: ${msg}`, rtTranscript);
        closeRealtime('error');
        break;
      }
      default:
        // ignore chatter: input_audio_buffer.*, rate_limits.updated, etc.
        break;
    }
  }

  function realtimeTools() {
    // Realtime API tools use flat shape (no outer {type:function, function:{...}}).
    const chatSchemas = toolSchemas();
    return chatSchemas.map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }));
  }

  // IPC adapters called from the widget renderer.
  async function realtimeStart() {
    const ok = await openRealtime();
    return ok;
  }

  function realtimeAudioChunk(chunk) {
    // chunk is an ArrayBuffer of int16 little-endian PCM at 24 kHz mono.
    if (!rt || rt.readyState !== 1) return;
    try {
      const buf = Buffer.from(chunk);
      const b64 = buf.toString('base64');
      if (sendRt({ type: 'input_audio_buffer.append', audio: b64 })) rtChunksSent++;
    } catch (e) {
      errLog(`rt audio chunk: ${e.message}`);
    }
  }

  function realtimeCommit() {
    if (!rt || rt.readyState !== 1) return;
    // 24 kHz samples; need at least 100 ms = 2400 samples = 4800 bytes before
    // the server will accept the commit. Each worklet chunk is ~2400 samples
    // (one chunk). Require at least 2 chunks to be safe.
    if (rtChunksSent < 2) {
      info(`rt commit skipped — only ${rtChunksSent} chunk(s) streamed`);
      showBubble('(hold a bit longer and speak)', '');
      closeRealtime('empty buffer');
      return;
    }
    sendRt({ type: 'input_audio_buffer.commit' });
    sendRt({ type: 'response.create', response: { output_modalities: ['text'] } });
  }

  function realtimeCancel() { closeRealtime('cancel'); }

  function toolStatusText(name, args) {
    switch (name) {
      case 'open_url':   return `Opening ${(args.url || '').replace(/^https?:\/\//, '').split('/')[0] || 'URL'}…`;
      case 'web_search': return `Searching ${args.engine || 'google'} for "${(args.query || '').slice(0, 40)}"…`;
      case 'open_app':   return `Launching ${args.name || 'app'}…`;
      case 'type_text':  return `Typing…`;
      case 'press_keys': return `Pressing ${args.keys || 'keys'}…`;
      case 'click_at':   return `Clicking…`;
      case 'scroll_at':  return `Scrolling…`;
      case 'wait':       return `Waiting ${(Number(args.ms || 0) / 1000).toFixed(1)}s…`;
      default:           return `Running ${name}…`;
    }
  }

  // --------- Tool schemas (sent to OpenAI) ---------
  function toolSchemas() {
    return [
      {
        type: 'function',
        function: {
          name: 'open_url',
          description: 'Open any URL in the user\'s default web browser. Use for websites like youtube.com, google.com, etc.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Full URL. If scheme missing, https:// will be prefixed.' } },
            required: ['url']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Open the browser directly to a search-results page. Prefer this over typing in a search box because the app does not have screen vision. Supported engines: youtube, google, bing, duckduckgo, amazon, wikipedia, reddit, github, twitter, maps.',
          parameters: {
            type: 'object',
            properties: {
              engine: { type: 'string', description: 'Search engine name. Default google.' },
              query:  { type: 'string', description: 'Search terms.' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'open_app',
          description: 'Launch an installed Windows application by common name (chrome, edge, firefox, notepad, calculator, explorer, word, excel, powershell, cmd, terminal, settings, paint, spotify, discord, etc.).',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'App name.' } },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'type_text',
          description: 'Type text into whatever control currently has keyboard focus. Does not click first — the focus must already be where you want it.',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'press_keys',
          description: 'Send a key combination. Examples: "enter", "tab", "ctrl+c", "ctrl+shift+t", "alt+tab", "escape", "f5". Refuses dangerous combos (Win+L, Ctrl+Alt+Del, Ctrl+Shift+Esc).',
          parameters: {
            type: 'object',
            properties: { keys: { type: 'string' } },
            required: ['keys']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'click_at',
          description: 'Move the mouse to screen coordinates in a 0-1000 grid (0,0 = top-left of primary monitor; 1000,1000 = bottom-right) and click. button is "left" (default), "right" or "double".',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' },
              button: { type: 'string', enum: ['left', 'right', 'double'] }
            },
            required: ['x', 'y']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'scroll_at',
          description: 'Scroll vertically. amount is positive to scroll up, negative to scroll down. If x/y omitted, scrolls at current mouse position.',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number', description: 'Notches of scroll. +3 = three up, -5 = five down.' },
              x: { type: 'number' }, y: { type: 'number' }
            },
            required: ['amount']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'wait',
          description: 'Pause before the next tool. Use this after open_url or open_app to let the page or app finish loading before you type into it. Typical values: 2500-4000 ms for a web page, 1000-1500 ms for a native app.',
          parameters: {
            type: 'object',
            properties: {
              ms: { type: 'number', description: 'Milliseconds to wait. Clamped to 100..10000.' }
            },
            required: ['ms']
          }
        }
      }
    ];
  }

  // --------- Tool executors ---------
  async function executeTool(name, args) {
    try {
      switch (name) {
        case 'open_url':   return toolOpenUrl(args.url);
        case 'web_search': return toolWebSearch(args.engine, args.query);
        case 'open_app':   return toolOpenApp(args.name);
        case 'type_text':  return await toolTypeText(args.text);
        case 'press_keys': return await toolPressKeys(args.keys);
        case 'click_at':   return await toolClickAt(args.x, args.y, args.button);
        case 'scroll_at':  return await toolScrollAt(args.amount, args.x, args.y);
        case 'wait':       return await toolWait(args.ms);
        default:           return { ok: false, error: `unknown tool: ${name}` };
      }
    } catch (e) {
      errLog(`tool ${name}: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async function toolWait(ms) {
    const n = Math.max(100, Math.min(10000, Number(ms) || 0));
    flyAiCursorToCentre(`waiting ${(n / 1000).toFixed(1)}s`, n + 500);
    await new Promise((r) => setTimeout(r, n));
    return { ok: true, message: `waited ${n}ms` };
  }

  function toolWebSearch(engine, query) {
    if (!query || typeof query !== 'string') return { ok: false, error: 'query required' };
    const q = encodeURIComponent(query.trim());
    const e = String(engine || 'google').toLowerCase().replace(/\s+/g, '');
    const map = {
      youtube:    `https://www.youtube.com/results?search_query=${q}`,
      yt:         `https://www.youtube.com/results?search_query=${q}`,
      google:     `https://www.google.com/search?q=${q}`,
      bing:       `https://www.bing.com/search?q=${q}`,
      duckduckgo: `https://duckduckgo.com/?q=${q}`,
      ddg:        `https://duckduckgo.com/?q=${q}`,
      amazon:     `https://www.amazon.com/s?k=${q}`,
      wikipedia:  `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
      wiki:       `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
      reddit:     `https://www.reddit.com/search?q=${q}`,
      github:     `https://github.com/search?q=${q}`,
      gh:         `https://github.com/search?q=${q}`,
      twitter:    `https://twitter.com/search?q=${q}`,
      x:          `https://twitter.com/search?q=${q}`,
      maps:       `https://www.google.com/maps/search/${q}`,
      googlemaps: `https://www.google.com/maps/search/${q}`
    };
    const url = map[e] || map.google;
    return visibleAct(
      `${e === 'google' ? 'Google' : e[0].toUpperCase() + e.slice(1)}: ${query}`,
      (l) => flyAiCursorToCentre(l, 3500),
      () => { shell.openExternal(url); return { ok: true, message: `searched ${e} for "${query}"` }; },
      950
    );
  }

  async function toolOpenUrl(url) {
    if (!url || typeof url !== 'string') return { ok: false, error: 'url required' };
    let u = url.trim();
    if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch { return { ok: false, error: 'invalid url' }; }
    const short = u.replace(/^https?:\/\//, '').split('/')[0];
    return visibleAct(
      `Opening ${short}`,
      (l) => flyAiCursorToCentre(l, 3500),
      () => { shell.openExternal(u); return { ok: true, message: `opened ${u}` }; },
      950
    );
  }

  const APP_ALIASES = {
    'chrome': 'chrome',
    'google chrome': 'chrome',
    'edge': 'msedge',
    'microsoft edge': 'msedge',
    'firefox': 'firefox',
    'notepad': 'notepad',
    'calculator': 'calc',
    'calc': 'calc',
    'file explorer': 'explorer',
    'explorer': 'explorer',
    'files': 'explorer',
    'word': 'winword',
    'microsoft word': 'winword',
    'excel': 'excel',
    'microsoft excel': 'excel',
    'powerpoint': 'powerpnt',
    'cmd': 'cmd',
    'command prompt': 'cmd',
    'powershell': 'powershell',
    'terminal': 'wt',
    'windows terminal': 'wt',
    'settings': 'ms-settings:',
    'paint': 'mspaint',
    'spotify': 'spotify',
    'discord': 'discord',
    'slack': 'slack',
    'vscode': 'code',
    'vs code': 'code',
    'visual studio code': 'code',
    'teams': 'teams',
    'outlook': 'outlook'
  };

  async function toolOpenApp(name) {
    if (!name || typeof name !== 'string') return { ok: false, error: 'app name required' };
    const key = name.toLowerCase().replace(/^(the\s+|open\s+)/, '').trim();
    const target = APP_ALIASES[key] || key;

    return visibleAct(
      `Launching ${name}`,
      (l) => flyAiCursorToCentre(l, 3500),
      () => {
        const { spawn } = require('node:child_process');
        try {
          const p = spawn('cmd.exe', ['/c', 'start', '', target], {
            detached: true, stdio: 'ignore', windowsHide: true
          });
          p.on('error', () => {});
          p.unref();
          return { ok: true, message: `launched ${target}` };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      950
    );
  }

  function psSendKeysEscape(text) {
    // Escape SendKeys special characters.
    return String(text).replace(/([+^%~{}()\[\]])/g, '{$1}').replace(/'/g, "''");
  }

  function runPowerShell(script) {
    return new Promise((resolve) => {
      const { spawn } = require('node:child_process');
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true, stdio: 'ignore'
      });
      const to = setTimeout(() => { try { p.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 8000);
      p.on('exit', (code) => { clearTimeout(to); resolve({ ok: code === 0, code }); });
      p.on('error', (e) => { clearTimeout(to); resolve({ ok: false, error: e.message }); });
    });
  }

  async function toolTypeText(text) {
    if (!text || typeof text !== 'string') return { ok: false, error: 'text required' };
    if (text.length > 1000) return { ok: false, error: 'text too long' };

    // Fly cursor to roughly where the real mouse is — a sensible proxy for
    // "the thing in focus" since we don't have UI Automation yet.
    const p = screen.getCursorScreenPoint();
    const preview = text.length > 48 ? text.slice(0, 48) + '…' : text;
    const escaped = psSendKeysEscape(text);
    const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 180; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
    return visibleAct(
      `Typing: ${preview}`,
      (l) => flyAiCursorTo(p.x, p.y, l, Math.max(2600, 400 + text.length * 50)),
      async () => {
        const r = await runPowerShell(script);
        return r.ok ? { ok: true, message: `typed ${text.length} chars` } : { ok: false, error: r.error || `exit ${r.code}` };
      },
      650
    );
  }

  const BLOCKED_COMBOS = new Set([
    'win+l', 'ctrl+alt+delete', 'ctrl+alt+del',
    'ctrl+shift+esc', 'ctrl+shift+escape',
    'win+x'
  ]);
  const KEY_TO_SENDKEYS = {
    enter: '{ENTER}', return: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}', esc: '{ESC}',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}', del: '{DELETE}',
    home: '{HOME}', end: '{END}',
    pageup: '{PGUP}', pagedown: '{PGDN}',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    space: ' ',
    insert: '{INSERT}', ins: '{INSERT}',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
    f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
  };

  async function toolPressKeys(keys) {
    if (!keys || typeof keys !== 'string') return { ok: false, error: 'keys required' };
    const combo = keys.toLowerCase().replace(/\s+/g, '').replace(/cmd/g, 'ctrl').replace(/option|opt/g, 'alt');
    if (BLOCKED_COMBOS.has(combo)) return { ok: false, error: 'refused: dangerous shortcut' };

    const parts = combo.split('+');
    const key = parts.pop();
    const mods = new Set(parts);
    if (mods.has('win')) return { ok: false, error: 'refused: Win key sequences blocked (except via dedicated tools)' };

    const sendKey = KEY_TO_SENDKEYS[key] || (key.length === 1 ? key : null);
    if (!sendKey) return { ok: false, error: `unknown key: ${key}` };

    let prefix = '';
    if (mods.has('ctrl'))  prefix += '^';
    if (mods.has('alt'))   prefix += '%';
    if (mods.has('shift')) prefix += '+';

    const escapedKey = key.length === 1 ? psSendKeysEscape(sendKey) : sendKey;
    const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('${prefix}${escapedKey}')`;
    const p = screen.getCursorScreenPoint();
    return visibleAct(
      `⌨  ${combo}`,
      (l) => flyAiCursorTo(p.x, p.y, l, 2600),
      async () => {
        const r = await runPowerShell(script);
        return r.ok ? { ok: true, message: `pressed ${combo}` } : { ok: false, error: r.error || `exit ${r.code}` };
      },
      550
    );
  }

  function gridToScreen(gx, gy) {
    const primary = screen.getPrimaryDisplay();
    const { bounds } = primary;
    const x = Math.round(bounds.x + (Math.max(0, Math.min(1000, gx)) / 1000) * bounds.width);
    const y = Math.round(bounds.y + (Math.max(0, Math.min(1000, gy)) / 1000) * bounds.height);
    return { x, y };
  }

  async function toolClickAt(gx, gy, button) {
    if (typeof gx !== 'number' || typeof gy !== 'number') return { ok: false, error: 'x,y required' };
    const { x, y } = gridToScreen(gx, gy);
    const b = (button || 'left').toLowerCase();
    flyAiCursorTo(x, y, `${b}-click`, 2800);
    await new Promise((r) => setTimeout(r, 950));
    // mouse_event flags
    const LEFTDOWN = 0x0002, LEFTUP = 0x0004;
    const RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
    const sequence = b === 'right'
      ? `[Win32.M]::mouse_event(${RIGHTDOWN},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Win32.M]::mouse_event(${RIGHTUP},0,0,0,[UIntPtr]::Zero)`
      : b === 'double'
      ? `[Win32.M]::mouse_event(${LEFTDOWN},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Win32.M]::mouse_event(${LEFTUP},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [Win32.M]::mouse_event(${LEFTDOWN},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Win32.M]::mouse_event(${LEFTUP},0,0,0,[UIntPtr]::Zero)`
      : `[Win32.M]::mouse_event(${LEFTDOWN},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Win32.M]::mouse_event(${LEFTUP},0,0,0,[UIntPtr]::Zero)`;
    const script = `
Add-Type -MemberDefinition @"
[System.Runtime.InteropServices.DllImport(\\"user32.dll\\")] public static extern void SetCursorPos(int x,int y);
[System.Runtime.InteropServices.DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags,int dx,int dy,uint dwData,System.UIntPtr dwExtraInfo);
"@ -Namespace Win32 -Name M;
[Win32.M]::SetCursorPos(${x}, ${y});
Start-Sleep -Milliseconds 80;
${sequence};
`;
    const r = await runPowerShell(script);
    return r.ok ? { ok: true, message: `${b}-click at (${x},${y})` } : { ok: false, error: r.error || `exit ${r.code}` };
  }

  async function toolScrollAt(amount, gx, gy) {
    if (typeof amount !== 'number' || amount === 0) return { ok: false, error: 'amount required' };
    const notches = Math.max(-20, Math.min(20, Math.round(amount)));
    const delta = notches * 120; // WHEEL_DELTA
    let moveScript = '';
    if (typeof gx === 'number' && typeof gy === 'number') {
      const { x, y } = gridToScreen(gx, gy);
      flyAiCursorTo(x, y, `scroll ${notches > 0 ? '↑' : '↓'} ${Math.abs(notches)}`, 2200);
      await new Promise((r) => setTimeout(r, 900));
      moveScript = `[Win32.M]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 60;`;
    } else {
      flyAiCursorToCentre(`scroll ${notches > 0 ? '↑' : '↓'} ${Math.abs(notches)}`, 2200);
      await new Promise((r) => setTimeout(r, 900));
    }
    const script = `
Add-Type -MemberDefinition @"
[System.Runtime.InteropServices.DllImport(\\"user32.dll\\")] public static extern void SetCursorPos(int x,int y);
[System.Runtime.InteropServices.DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags,int dx,int dy,int dwData,System.UIntPtr dwExtraInfo);
"@ -Namespace Win32 -Name M;
${moveScript}
[Win32.M]::mouse_event(0x0800, 0, 0, ${delta}, [UIntPtr]::Zero);
`;
    const r = await runPowerShell(script);
    return r.ok ? { ok: true, message: `scrolled ${notches} notches` } : { ok: false, error: r.error || `exit ${r.code}` };
  }

  // --------- Blue AI cursor overlay ---------
  function createAiCursorWindow() {
    if (aiCursorWin && !aiCursorWin.isDestroyed()) return aiCursorWin;
    const primary = screen.getPrimaryDisplay();
    const { bounds } = primary;
    aiCursorWin = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, hasShadow: false,
      focusable: false, show: false, backgroundColor: '#00000000',
      type: 'toolbar',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    aiCursorWin.setAlwaysOnTop(true, 'screen-saver');
    aiCursorWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    aiCursorWin.setIgnoreMouseEvents(true, { forward: false });
    aiCursorWin.setMenuBarVisibility(false);
    aiCursorWin.loadFile(path.join(__dirname, 'renderer', 'cursor.html'));
    aiCursorWin.once('ready-to-show', () => aiCursorWin.showInactive());
    aiCursorWin.on('closed', () => { aiCursorWin = null; });
    return aiCursorWin;
  }

  function flyAiCursorTo(screenX, screenY, labelText, dwellMs) {
    const w = createAiCursorWindow();
    const b = w.getBounds();
    const localX = screenX - b.x;
    const localY = screenY - b.y;

    // Starting point for the flight = centre of the home-widget character.
    // This way the AI cursor visibly leaves the character and goes to the target.
    let fromX = localX;
    let fromY = localY;
    if (widgetWin && !widgetWin.isDestroyed()) {
      const wb = widgetWin.getBounds();
      fromX = (wb.x + wb.width / 2) - b.x;
      fromY = (wb.y + wb.height / 2) - b.y;
    }

    const payload = {
      fromX, fromY,
      x: localX, y: localY,
      labelText: labelText || '',
      dwellMs: dwellMs || 3200
    };
    if (w.webContents.isLoading()) {
      w.webContents.once('did-finish-load', () => {
        w.webContents.send('aicursor:fly', payload);
      });
    } else {
      w.webContents.send('aicursor:fly', payload);
    }
  }

  function flyAiCursorToCentre(labelText, dwellMs) {
    const primary = screen.getPrimaryDisplay();
    const { bounds } = primary;
    flyAiCursorTo(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, labelText, dwellMs);
  }

  // Fly cursor with a label, pause so the user actually sees it, then run the
  // real work. Default pause > CSS flight duration so the user sees the
  // character finish moving before the action fires.
  async function visibleAct(labelText, flyFn, workFn, pauseMs) {
    try { flyFn(labelText); } catch {}
    await new Promise((r) => setTimeout(r, pauseMs || 950));
    return workFn();
  }

  // --------- tray ---------

  // --------- tray ---------
  function makeTrayIcon() {
    const p = path.join(__dirname, 'tray.png');
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
    return nativeImage.createEmpty();
  }

  function buildMenu() {
    const widgetVisible = !!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible());
    return Menu.buildFromTemplate([
      { label: 'Hold the character and talk', enabled: false },
      { type: 'separator' },
      {
        label: 'Show character',
        type: 'checkbox',
        checked: widgetVisible,
        click: () => toggleWidget()
      },
      {
        label: 'Let him use the computer',
        type: 'checkbox',
        checked: loadSettings().allowComputerUse !== false,
        click: () => {
          const s = loadSettings();
          s.allowComputerUse = !s.allowComputerUse;
          saveSettings(s);
          refreshTrayMenu();
        }
      },
      {
        label: 'Home position',
        submenu: ['left', 'center', 'right'].map((pos) => ({
          label: pos.charAt(0).toUpperCase() + pos.slice(1),
          type: 'radio',
          checked: loadSettings().homePosition === pos,
          click: () => {
            const s = loadSettings();
            s.homePosition = pos;
            s.customWidgetX = null;
            s.customWidgetY = null;
            saveSettings(s);
            repositionWidget();
          }
        }))
      },
      { type: 'separator' },
      { label: 'OpenAI Key…', click: createApiKeyWindow },
      { label: 'Settings…', click: createSettingsWindow },
      { type: 'separator' },
      { label: 'Open logs folder', click: () => shell.openPath(path.dirname(LOG_FILE || '')) },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } }
    ]);
  }

  function refreshTrayMenu() {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
  }

  // --------- IPC ---------
  ipcMain.handle('key:get',   () => readKey());
  ipcMain.handle('key:save',  (_, k) => writeKey(String(k || '')));
  ipcMain.handle('key:clear', () => clearKey());
  ipcMain.handle('key:test',  (_, k) => testOpenAIKey(String(k || '')));
  ipcMain.handle('key:has',   () => hasKey());
  ipcMain.handle('settings:get',  () => loadSettings());
  ipcMain.handle('settings:save', (_, s) => saveSettings(s || {}));
  ipcMain.handle('shell:openExternal', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  ipcMain.on('window:close', (ev) => {
    const w = BrowserWindow.fromWebContents(ev.sender);
    if (w) w.close();
  });

  ipcMain.on('widget:contextMenu', () => {
    if (tray && !tray.isDestroyed()) tray.popUpContextMenu(buildMenu());
  });

  ipcMain.on('widget:beginDrag', () => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    if (dragInterval) return;
    const start = screen.getCursorScreenPoint();
    const b = widgetWin.getBounds();
    const ox = start.x - b.x;
    const oy = start.y - b.y;
    dragInterval = setInterval(() => {
      if (!widgetWin || widgetWin.isDestroyed()) {
        clearInterval(dragInterval); dragInterval = null; return;
      }
      const p = screen.getCursorScreenPoint();
      widgetWin.setPosition(p.x - ox, p.y - oy, false);
      hideBubble(); // bubble repositions on next show
    }, 12);
  });

  ipcMain.on('widget:endDrag', () => {
    if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const b = widgetWin.getBounds();
    const s = loadSettings();
    s.customWidgetX = b.x;
    s.customWidgetY = b.y;
    saveSettings(s);
  });

  ipcMain.on('widget:openApiKey', () => createApiKeyWindow());

  ipcMain.handle('talk', async (_, payload) => talkTranscribeAndChat(payload));

  // Realtime WebSocket adapters
  ipcMain.handle('rt:start',  async () => realtimeStart());
  ipcMain.on('rt:audio',      (_, buf) => realtimeAudioChunk(buf));
  ipcMain.on('rt:commit',     () => realtimeCommit());
  ipcMain.on('rt:cancel',     () => realtimeCancel());

  ipcMain.on('bubble:show', (_, data) => showBubble(data.reply, data.user));
  ipcMain.on('bubble:hide', () => hideBubble());
  ipcMain.on('bubble:nav',  (_, dir) => {
    if (bubbleItems.length === 0) return;
    const delta = dir === 'next' ? 1 : -1;
    showBubbleAt(bubbleCursor + delta);
  });
  ipcMain.on('bubble:close', () => hideBubble());
  ipcMain.on('bubble:setIgnore', (_, ignore) => {
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.setIgnoreMouseEvents(!!ignore, { forward: true });
    }
  });

  // --------- lifecycle ---------
  app.on('second-instance', () => {
    if (apiKeyWin) apiKeyWin.focus();
    else if (settingsWin) settingsWin.focus();
    else createApiKeyWindow();
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray.
  });

  app.whenReady().then(() => {
    initLog();
    info('app ready');

    // One-time migration: if the user has data from the old "googly-eyes"
    // name but no data in the new "magna-buddy" folder yet, copy settings
    // and encrypted key so they don't have to reconfigure after the rename.
    try {
      const newDir = app.getPath('userData');
      const legacyDir = path.join(path.dirname(newDir), 'googly-eyes');
      if (fs.existsSync(legacyDir) && !fs.existsSync(path.join(newDir, 'settings.json'))) {
        fs.mkdirSync(newDir, { recursive: true });
        for (const f of ['settings.json', 'keys.bin']) {
          const src = path.join(legacyDir, f);
          const dst = path.join(newDir, f);
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            fs.copyFileSync(src, dst);
            info(`migrated ${f} from googly-eyes/`);
          }
        }
      }
    } catch (e) {
      errLog(`migration: ${e.message}`);
    }

    // Allow microphone access from our own renderers.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === 'media' || permission === 'microphone') return callback(true);
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media' || permission === 'microphone';
    });

    try {
      tray = new Tray(makeTrayIcon());
      tray.setToolTip('MAGNA Buddy — press-and-hold the character to talk');
      tray.setContextMenu(buildMenu());
      tray.on('double-click', createApiKeyWindow);
    } catch (e) {
      errLog(`tray init: ${e.message}`);
      dialog.showErrorBox('MAGNA Buddy', `Could not create tray icon: ${e.message}`);
    }

    if (!hasKey()) {
      try {
        new Notification({
          title: 'MAGNA Buddy',
          body: 'Click the character bottom-right (or right-click it) → OpenAI Key… to add your key.',
          silent: true
        }).show();
      } catch { /* notifications are best-effort */ }
    }

    // Show the on-screen character widget unless disabled.
    try {
      const s = loadSettings();
      if (s.showWidget !== false) createWidgetWindow();
    } catch (e) {
      errLog(`widget init: ${e.message}`);
    }
  });

  app.on('before-quit', () => info('app exiting'));
}
