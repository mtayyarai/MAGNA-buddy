# MAGNA Buddy

Small Windows desktop companion that lives in a bottom-right on-screen
character. Press-and-hold the character to talk, release to send. Replies
appear in a sticky speech bubble with history navigation. The AI can take
actions on your PC — open URLs, launch apps, search the web, type, press
keys, click and scroll — and you see a mini version of the character fly
out of the home widget to execute each action.

Based on the behavioural spec in `googly-eyes-windows-PRD.md`.

![MAGNA Buddy character](docs/character.png) <!-- optional screenshot -->

## Features

- **Push-to-talk character** — a Magna-red googly-eyed blob docked bottom-right
  of the primary monitor. Press and hold to talk, release to send. Drag it
  anywhere; position is remembered.
- **OpenAI Realtime API (GA)** — WebSocket, text-only output, 24 kHz PCM16
  pipeline, Whisper transcription. Model picker in Settings
  (gpt-realtime-2.1-mini default, gpt-live-1, gpt-realtime-2.1, etc.).
- **Computer-use tools** (function calling)
  - `open_url(url)` — opens any URL in the default browser
  - `web_search({engine, query})` — direct search on
    youtube / google / bing / duckduckgo / amazon / wikipedia / reddit /
    github / twitter / maps
  - `open_app(name)` — resolves Chrome, Edge, Notepad, Word, VS Code, etc.
  - `type_text(text)` / `press_keys(combo)` — SendKeys via PowerShell;
    refuses dangerous combos (Win+L, Ctrl+Alt+Del, …)
  - `click_at(x, y, button)` / `scroll_at(amount, x, y)` — Win32
    `SetCursorPos` + `mouse_event`
- **Visible AI cursor** — mini Magna-red character flies out of the home
  widget to the action target with a labelled badge
  (`Opening youtube.com`, `⌨ ctrl+t`, `Typing: …`). Bounces on landing.
- **Sticky speech bubble** with ◀ history ▶, copy, ✕ buttons; keyboard
  nav (← → Esc); last 30 replies kept; click-through on transparent
  pixels so it never blocks the rest of your screen.
- **Procedural sound effects** on press, release, cursor landing, response
  arrival.
- **Encrypted key** at rest (Electron `safeStorage` → DPAPI on Windows,
  Keychain on macOS).

## Install (Windows)

Grab the latest installer from the GitHub Releases page, or build from
source:

```powershell
npm install
npm run dist
```

Output lands at `dist\MAGNA-Buddy-Setup-<version>.exe`. Run it,
right-click the character in the system tray → **OpenAI Key…** →
paste `sk-…` → **Save**. Then press-and-hold the character and speak.

## Data locations

| What            | Path                                              |
|-----------------|---------------------------------------------------|
| Settings JSON   | `%APPDATA%\magna-buddy\settings.json`             |
| OpenAI key      | `%APPDATA%\magna-buddy\keys.bin` (DPAPI, user)    |
| Logs            | `%APPDATA%\magna-buddy\logs\app-*.log`            |

Upgrading from the pre-rename "Googly Eyes" builds: on first launch the
app auto-copies settings + key from `%APPDATA%\googly-eyes\` so you don't
have to re-enter anything.

## Mac build

Config is in place (`npm run dist:mac`), including universal arch,
entitlements, and `Info.plist` with microphone + AppleScript usage
descriptions. **Must be run on macOS** — electron-builder refuses the
DMG step on Windows. Four of the computer-use tools (`type_text`,
`press_keys`, `click_at`, `scroll_at`) are Windows-only today and would
need AppleScript equivalents on macOS.

## Development

```powershell
npm install
npm start           # electron . with live source
```

## Project layout

```
package.json
scripts/
  make-icons.js     — generates tray.png + icon.ico (pure Node, Magna palette)
  dump-key.js       — local-only key dump via Electron safeStorage
src/
  main.js           — tray, IPC, realtime WS session, tool executors
  preload.js        — contextBridge API for renderers
  renderer/
    widget.html/.js       — home-widget character + press-to-talk
    cursor.html/.js       — AI character cursor overlay
    bubble.html/.js       — sticky speech bubble + history nav
    settings.html/.js     — model picker, personality, hotkeys, flags
    apiKey.html/.js       — OpenAI key dialog
    audio-worklet.js      — PCM16 24 kHz capture
    styles.css            — shared window styles
build/
  entitlements.mac.plist
  icon.{png,ico}          — generated
VERSIONS.md         — per-build history
```

## Attribution

Behavioural reference: `rbrown101010/bluey-by-riley` (Mac + iOS Swift
original). This port re-implements the behaviour on Windows and does not
reuse the original source. Brand colours (`#dc3232`, `#821e14`,
`#32b446`) belong to MAGNA.
