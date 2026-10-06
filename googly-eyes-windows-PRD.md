# PRD & Build Plan — "Googly Eyes for Windows" (desktop .exe port of `rbrown101010/bluey-by-riley`)

> **Audience:** Claude Code (build executor). Read this whole file before writing code.
> **Goal:** Rebuild the macOS + iPhone app "Googly Eyes" as a **single native Windows desktop app (.exe)** with the same behaviour. **No Swift, no iPhone required.**
> **Source repo (reference only):** https://github.com/rbrown101010/bluey-by-riley — clone it and keep it open as the behavioural spec. Port behaviour, prompts and tool contracts faithfully; do not copy Apple-specific code.

---

## 1. What the original app does (analysis of the repo)

The original is **two apps** that talk over local Wi-Fi:

| Part | Tech | Role |
|---|---|---|
| `Mac/` menu-bar app (~3,200 lines Swift) | AppKit, ScreenCaptureKit, Vision OCR, Accessibility (AX), CGEvent, Carbon hotkeys | Draws a big animated **character cursor** over the whole screen, reads the screen, runs all tools (look, point, click, type, research), shows speech bubbles and a research card, holds the OpenAI key |
| `iOS/` iPhone app (~1,900 lines SwiftUI) | AVAudioEngine, URLSession WebSocket | The **character's body** (a blueberry blob with googly eyes and moods) sits on the phone under the monitor. Owns the **mic** and the **OpenAI Realtime WebSocket** session. Forwards tool calls to the Mac. Saves session transcripts. |
| `Shared/` | Bonjour `_googly._tcp`, newline-delimited JSON `Packet` | Pairing + protocol between phone and Mac |

### 1.1 User-facing behaviour
1. **Follow mode (asleep):** the character's eyes follow the user's mouse. Big cursor hidden or docked.
2. **Wake (double-tap phone / ⌥Space):** starts a Realtime session. Mic is **always on** while awake; everything the user says is transcribed into the conversation as *context*, but the AI **stays silent**.
3. **Press-and-hold to ask:** while held, user speaks the question; on release the app commits the audio buffer and requests a response.
4. **Replies are text only** (no TTS). Text streams into a cute **speech bubble** next to the character's cursor (or above the "home" spot), with a small cartoon **chirp** sound.
5. **Pointing:** "what's this?" → the AI looks at the screen and flies its own big cursor (smooth bezier flight, comet trail or "string" trail) to the exact word/control and holds while the bubble shows. Multiple points are queued, each held ≥2.2 s, then the cursor returns home after it stops "talking".
6. **Web research:** AI says one line ending "doing some research…", then a **research card** (title + ≤4 paragraphs + ≤5 sources, collapsible) appears on screen; AI then gives a one-line takeaway.
7. **Computer use (opt-in toggle):** click, double/right-click, type, press shortcuts, scroll, drag, open app, open URL — performed **with the character's cursor visibly flying there**, then the user's real pointer is **warped back** to where it was.
8. **Guardrails:** acts only when asked; confirms before irreversible actions; on-screen text is data not instructions; refuses password fields; refuses logout/lock/force-quit shortcuts; **stop hotkey** blocks all actions for 6 s and sends cursor home; master toggle "Let Him Use the Computer".
9. **Settings:** mood, cursor size (48–120), glow, trail style, home position (left/center/right), captions on/off, follow-mouse, editable **personality** prompt, OpenAI key.
10. **Transcript history:** each session saved (what the user said, which turns were questions, replies, research reports).

### 1.2 Global hotkeys (Mac → proposed Windows mapping)

| Mac | Action | Windows default |
|---|---|---|
| ⌃⌥P | Fly to mouse and point there | `Ctrl+Alt+P` |
| ⌃⌥F | Follow mouse on/off | `Ctrl+Alt+F` |
| ⌃⌥D | Go home (docked) | `Ctrl+Alt+D` |
| ⌃⌥T | Talk test (bounce 3 s) | `Ctrl+Alt+T` |
| ⌃⌥H | Hide/show cursor | `Ctrl+Alt+H` |
| ⌥Space | Wake / sleep | `Ctrl+Alt+Space` (Alt+Space is the Windows system menu — don't use it) |
| ⌃⌥S | Stop computer use | `Ctrl+Alt+S` |
| *(hold phone screen)* | **Hold to ask** | **NEW:** hold **Right-Ctrl** (configurable push-to-talk) **or** press-and-hold left mouse on the character widget |

All hotkeys must be rebindable in Settings.

### 1.3 AI stack used by the original

| Purpose | Model / API | Notes |
|---|---|---|
| Live conversation + tool calling | **OpenAI Realtime API**, model `gpt-realtime-2.1`, `output_modalities: ["text"]` | WebSocket. Server VAD with `create_response: false`, `interrupt_response: false`; PCM16 24 kHz mono; `noise_reduction: near_field` |
| Transcribing everything the user says | `gpt-4o-mini-transcribe` (inside the Realtime session) | |
| Web research reports | **OpenAI Responses API**, model `gpt-5.5`, `reasoning.effort: low`, built-in `web_search` tool | Parses `annotations` for source URLs, strips markdown/inline citations |
| Screen understanding | Screenshot JPEG (max edge 1100 px, q≈0.72) **+** a structured text list of OCR words/lines and clickable controls with ids and 0–1000 grid coords | The image is sent as a follow-up `input_image` user message after the tool output |

---

## 2. Product decision for Windows

**One app, no phone.** The phone's job (character body + mic + Realtime session) moves into the desktop app:

- The **character's body** becomes a small, always-on-top, frameless, transparent **"home widget"** docked at the bottom edge of the primary monitor (left / center / right), showing the blueberry face with googly eyes and moods. This is where the cursor "docks" and where bubbles appear when not pointing.
- The **PC microphone** feeds the Realtime session directly.
- The desktop app opens the Realtime WebSocket **itself** using the stored API key (no ephemeral token minting needed since the key never leaves the machine). Keep the token-minting code path behind an interface anyway so a phone companion can be added later.
- Lives in the **system tray** (equivalent of the macOS menu bar item).

Out of scope for v1: iPhone/Android companion, multi-monitor pointing (v1 = primary monitor only, same as the original), voice output/TTS.

---

## 3. Recommended tech stack

### 3.1 Choice: **C# / .NET 8 (or 9) + WPF**, published as a single self-contained `.exe`

Why this over alternatives:

| Need | .NET/WPF | Tauri (Rust+web) | Electron |
|---|---|---|---|
| Transparent, click-through, always-on-top full-screen overlay at 60 fps | ✅ WPF `AllowsTransparency` + `WS_EX_TRANSPARENT|WS_EX_LAYERED|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE` | ✅ but fiddly | ✅ heavy |
| Exclude own windows from screenshots | ✅ `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` | ✅ via `windows` crate | ⚠️ |
| OCR with **per-word bounding boxes** (the Vision equivalent) | ✅ **`Windows.Media.Ocr`** directly (WinRT projection) | ⚠️ via `windows` crate | ❌ needs native addon |
| Read clickable controls (the AX equivalent) | ✅ **UI Automation** via **FlaUI** (UIA3) | ⚠️ `uiautomation` crate | ❌ |
| Synthesize mouse/keyboard | ✅ `SendInput` P/Invoke | ✅ | ⚠️ addon |
| Low-level key hook for hold-to-talk | ✅ `WH_KEYBOARD_LL` | ✅ | ⚠️ |
| Mic capture PCM16 24 kHz | ✅ NAudio (WASAPI) | ✅ cpal | ✅ |
| Easy for Claude Code to build & debug | ✅ one language, rich Windows APIs | medium | medium |

### 3.2 Packages
- `FlaUI.UIA3` — UI Automation tree walking, `IsPassword`, focused element.
- `NAudio` — WASAPI mic capture + resampling to 24 kHz mono PCM16; play chirp WAVs.
- `System.Net.WebSockets.ClientWebSocket` — Realtime API.
- `System.Text.Json` — protocol.
- `H.NotifyIcon.Wpf` (or WinForms `NotifyIcon`) — tray icon + menu.
- `Microsoft.Windows.SDK.NET` via `<TargetFramework>net8.0-windows10.0.19041.0</TargetFramework>` — gives `Windows.Media.Ocr`, `Windows.Graphics.Imaging`, `Windows.Graphics.Capture`.
- Secrets: **Windows Credential Manager** (`CredWrite`/`CredRead` P/Invoke) or DPAPI (`ProtectedData`, CurrentUser scope) → `%APPDATA%\GooglyEyes\keys.bin`. Never in the repo, never in logs.
- Settings: JSON at `%APPDATA%\GooglyEyes\settings.json`. Transcripts: `%APPDATA%\GooglyEyes\sessions\*.json`.
- Fonts: bundle the repo's OFL fonts (`Fredoka`, `IBM Plex Sans/Mono`) as WPF resources (licences are OFL — include the OFL text files).

### 3.3 Build / packaging
```
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```
- Output: `GooglyEyes.exe`. Optional later: MSIX or Inno Setup installer, code signing.
- App manifest: `PerMonitorV2` DPI awareness (**critical** for click accuracy), `asInvoker`.
- Minimum OS: Windows 10 2004 (build 19041) for `WDA_EXCLUDEFROMCAPTURE`; target Windows 11.

---

## 4. Which AI to use

### 4.1 Default (ship this): **same as the original — OpenAI**
- **Realtime:** `gpt-realtime-2.1` (configurable string) over WebSocket `wss://api.openai.com/v1/realtime?model=…` with `Authorization: Bearer <key>`. Send the session config via `session.update` right after connect (copy the exact `session` object from `RealtimeHost.swift` → `static var session`).
- **Transcription:** `gpt-4o-mini-transcribe` inside the session.
- **Research:** Responses API `gpt-5.5` + `web_search`, `reasoning.effort: "low"`, 90 s timeout.
- Reason: the whole UX (always-listening context, silent until push-to-talk, streaming text, tool calls mid-session) maps 1:1 onto the Realtime API; this is the lowest-risk port.
- **All model names must be settings, not constants** — verify they're current when building; fall back gracefully with a clear error bubble if OpenAI rejects one.

### 4.2 Optional provider (Phase 6): **Claude for the "brain"**
Architecture: local VAD + streaming STT (e.g. OpenAI transcribe or another STT) keeps a rolling transcript → on push-to-talk release, send transcript + tools to **Anthropic Messages API** (`claude-sonnet-5-5`, streaming, tool use) → same tool executor. Claude is strong at screenshot-grounded computer use, but there is no single realtime speech session, so latency is higher. Implement behind an `IAssistantBrain` interface so the provider is a setting. Do **not** start here.

---

## 5. Architecture

```
GooglyEyes.exe (WPF, single process)
├─ App / TrayIcon ............ tray menu (= Mac menu bar), settings window, personality editor, key dialog
├─ Overlay/
│   ├─ OverlayWindow ......... full-primary-screen, transparent, click-through, topmost, excluded from capture
│   ├─ CursorEngine .......... flight physics (port TimingCurve + CursorOverlay.swift), modes: Docked / Following / Pinned(pt)
│   ├─ Effects ............... comet trail, string-to-home trail, glow, click squish, typed-text puffs, key bubble
│   └─ SpeechBubble .......... streaming caption, auto-placed above the pointed thing (speechTarget rect)
├─ HomeWidget/
│   ├─ HomeWindow ............ small topmost transparent window at bottom edge; hit-testable (press-and-hold to ask, double-click to wake)
│   └─ FaceRenderer .......... port FaceView.swift + BlobShape.swift (moods: listening, resting, thinking, talking, pointing, happy, sleepy; blink, gaze, talk bounce, breathing)
├─ Voice/
│   ├─ MicCapture ............ NAudio WASAPI → 24 kHz mono PCM16 → base64 chunks (~100 ms)
│   ├─ RealtimeSession ....... port LiveVoice.swift state machine (asleep, waking, listening, asking, thinking, speaking)
│   └─ Chirp ................. short cartoon sound on first text delta of each response; volume setting
├─ Brain/
│   ├─ IAssistantBrain ....... OpenAIRealtimeBrain (default), ClaudeBrain (later)
│   ├─ Prompts ............... personality (editable) + toolGuide + computerGuide (copy verbatim from RealtimeHost.swift, adapt "iPhone"/"Mac" wording)
│   └─ ToolRegistry .......... JSON schemas identical to the original tool list
├─ Tools/
│   ├─ ToolHost .............. port RealtimeHost.runTool / runAction; tools run serially (chained Task)
│   ├─ Pointing choreography . queue, minimumHold 2.2 s, idleHome 5 s, home after speaking stops
│   └─ WebResearch ........... Responses API + report parsing (port WebResearch.swift)
├─ Screen/
│   ├─ ScreenCapture ......... primary monitor, physical pixels, no cursor, own windows excluded
│   ├─ OcrReader ............. Windows.Media.Ocr → lines (L#) + words (W#) with rects (cap 400 lines / 600 words)
│   ├─ ControlsReader ........ UIA → controls (C#) of foreground window + its menu bar (cap 140, 450 ms budget)
│   └─ ScreenSnapshot ........ targetList text (exact format of the original), target(id), target(near:)
├─ Input/
│   ├─ InputSynth ............ SendInput: move, click, double, right, drag, scroll, unicode typing, key combos
│   ├─ HotKeys ............... RegisterHotKey for toggles + WH_KEYBOARD_LL hook for hold-to-talk & stop
│   └─ AppLauncher ........... open_app (Start-menu shortcuts, App Paths, UWP via shell:AppsFolder), open_url
├─ ReportCard/ ............... research card window (loading / report / error; collapsed preview ↔ expanded; sources clickable)
└─ Storage/ .................. settings, secrets (DPAPI/Credential Manager), transcripts
```

### 5.1 Coordinate system (get this right first)
- Internally use **physical pixels of the primary monitor, origin top-left** for capture, OCR rects, UIA `BoundingRectangle` and `SendInput`.
- Convert to WPF DIPs only when drawing (`PresentationSource.CompositionTarget.TransformFromDevice`).
- Grid conversion for the model: `gx = round(x / screenWidthPx * 1000)`, same for y. `gridPoint(gx,gy) = (clamp(gx,0,1000)/1000*W, …)`.
- `SendInput` absolute coords: normalise to 0–65535 over the **virtual desktop** with `MOUSEEVENTF_VIRTUALDESK`.

---

## 6. Functional requirements (port checklist)

### 6.1 `look_at_screen` (port `ScreenReader.swift` + `ControlsReader.swift`)
- Capture primary monitor at native resolution, **without** the system cursor and **without** our overlay/home/report windows (`WDA_EXCLUDEFROMCAPTURE` on all our windows; capture via `Windows.Graphics.Capture` with `IsCursorCaptureEnabled=false`, or GDI `BitBlt` fallback).
- OCR with `Windows.Media.Ocr`:
  - `OcrEngine.TryCreateFromUserProfileLanguages()`; setting to pick OCR language (e.g. `en-US`, `ar-SA`) — warn if the language pack isn't installed.
  - Respect `OcrEngine.MaxImageDimension`; if the screen is larger, **tile** (overlapping strips) and merge results, or scale and map rects back.
  - Sort reading order top→bottom, left→right; ids `L1…` per line, `W1…` per word (global counter, cap 600 words, 400 lines).
- UIA controls (FlaUI): foreground window (`GetForegroundWindow`) + its menu bar. Map control types: Button, SplitButton, MenuItem(top-level), ComboBox, CheckBox, RadioButton, Edit, Document(text area), Hyperlink, Slider, TabItem, Spinner, TreeItem(disclosure). Label = Name → HelpText → placeholder; for edits append `contains: <value 40 chars>`. Skip rects ≤3 px or off-screen; dedupe by rect; sort reading order; ids `C1…`; cap 140; **450 ms time budget**; run in parallel with OCR on a background thread (UIA must use an MTA thread).
- Chromium/Electron apps: UIA works natively on Windows; no extra flag needed, but test VS Code, Slack, Chrome.
- Output text: **exact same format** as `ScreenSnapshot.targetList`, plus the mouse line: `The user's mouse pointer is at @x,y, on W12 "word". When they say "this", "that" or "here", they mean what's at their mouse pointer.`
- Return JPEG (max edge 1100 px, quality 72) base64. After sending `function_call_output`, send a `conversation.item.create` user message with `input_image` (data URL), then `response.create` — mirror `LiveVoice.swift` lines ~265–290.
- If capture fails → return the "I can't see the screen…" message.

### 6.2 Pointing tools
- `point_at(target_id)` → point to `(rect.midX, rect.maxY + 3)`; speech target = rect. Return `Pointing at "…"` or `Queued: …` exactly like the original.
- `point_at_spot(x,y)` grid → point with a 32 px speech-target square.
- `stop_pointing` → request home after speaking stops (+1.2 s).
- `go_to_sleep` → return "Going to sleep. Say a very short goodbye." then end session after the reply.
- Choreography timer at 30 Hz: port `choreograph()` logic verbatim (queue, holdUntil = now + 1.0 + 2.2, idleHome 5 s).

### 6.3 Computer-use tools (only if setting enabled)
Port each case of `runAction` 1:1:
- **click**: save real cursor → fly character → click effect → wait 90 ms → `SendInput` move+down/up (double = two clicks 80 ms apart; right = right button) → warp real cursor back with `SetCursorPos` → wait 380 ms → re-look with prefix `Clicked "…"`.
- **type_text**: check focused element via UIA; if `IsPassword` → refuse ("That's a password field…"). Fly near the field's left edge if its rect is sane. Type with `KEYEVENTF_UNICODE` in small chunks (show typed puffs). `\n` → Enter. Optional `press_return` then re-look.
- **press_keys**: parse `ctrl+shift+n`, `alt+tab`, `win+r`, `enter/return`, `esc/escape`, `tab`, arrows, `f1–f12`, `pageup/down`, `home/end`, `delete/backspace`. Accept Mac words and translate (`cmd`→`ctrl`, `option`→`alt`). Show key label bubble. **Refuse**: `win+l`, `ctrl+alt+delete`, `ctrl+shift+esc`, `alt+f4` when foreground is the desktop/shell (shutdown dialog), `win+x` sequences ending in sign-out/shutdown. Return the same refusal text.
- **scroll**: `MOUSEEVENTF_WHEEL` / `HWHEEL`, 120 per notch × amount(1–10, default 3), at target or screen centre; warp back.
- **drag**: fly to `from`, `LEFTDOWN`, then **move the real input along the animated cursor path every 16 ms** until it arrives, `LEFTUP`, warp back.
- **open_app**: resolve by name via Start-menu `.lnk` files (`%ProgramData%` and `%AppData%\Microsoft\Windows\Start Menu`), `App Paths` registry, and UWP apps (`shell:AppsFolder\<AUMID>` via `Get-StartApps`-equivalent enumeration). Fuzzy match. If already running, bring to foreground (`AllowSetForegroundWindow` / `SetForegroundWindow` dance). Wait 900 ms, re-look.
- **open_url**: normalise (`excalidraw.com` → `https://excalidraw.com`), `Process.Start` with `UseShellExecute=true`. Wait 1100 ms, re-look.
- **Refusal gate** before every action: setting off → message; within 6 s of Stop → message; tool chain is serial.
- **UIPI note:** a non-elevated app can't send input to elevated (admin) windows. Detect (foreground process elevated & we're not) and return a clear message instead of silently failing.

### 6.4 `web_research`
- Port `WebResearch.swift` exactly: request body, instructions text, annotation-based sources (≤5, strip `utm_source`), markdown/citation stripping, first line = title, ≤4 paragraphs.
- Context = first 40 OCR lines joined with ` / `.
- Show the **report card** in loading state immediately; then report or error.
- Tool output = `"The full report is now in a card…" + "\n---REPORT---\n" + plainText` (marker used to save the report to the transcript).

### 6.5 Realtime session (port `LiveVoice.swift`)
- States: `asleep → waking → listening ⇄ asking → thinking → speaking → listening`.
- Wake: check mic permission (Windows Settings → Privacy → Microphone; show a helpful bubble if blocked) → connect → `session.update` → start streaming mic (`input_audio_buffer.append`).
- **Hold to ask:** on press mark "holding"; on release send `input_audio_buffer.commit` then `response.create`. If released before session is ready, ask as soon as it's ready.
- Handle events: `response.created`, `response.output_text.delta` (stream into bubble + chirp once), `input_audio_buffer.committed`, `conversation.item.input_audio_transcription.completed` (to transcript; mark asked turns), `response.done` (collect `function_call` items → run tools serially → `function_call_output` → optional image message → `response.create`), `error` (bubble).
- Caption timing: on done, keep bubble for `min(max(2.8, 1.2 + words*0.32), 12) + 3` seconds.
- Session auto-reconnect if the socket drops while awake; respect Realtime session max duration (reconnect transparently, re-send session config).
- Mood drive: listening (awake idle), thinking (after ask, before text), talking (text streaming; talk level animates), pointing (cursor pinned), sleepy (asleep), happy/resting via menu.

### 6.6 Overlay & character visuals (port `CursorOverlay.swift`, `FaceView.swift`, `BlobShape.swift`, `Palette.swift`)
- Port `TimingCurve` (launch / redirect / steady bezier curves) and flight planning, mid-flight redirects, `timeToArrive`, `press(depth)` squish, dragging state.
- Render with WPF `CompositionTarget.Rendering` (vsync); keep allocations out of the render loop. Target 60 fps with <3% CPU idle.
- Trails: comet, string-to-home, none. Glow toggle. Cursor size 48–120 (default 72).
- Speech bubble: Fredoka font, rounded, tail pointing to the cursor; positioned above the `speechTarget` rect (never covering it), clamped on-screen.
- Home widget: blueberry blob + googly eyes, eyes follow real mouse (gaze −1…1), blink on mood change, breathing, talk bounce, sleepy heavy lids. Copy colours from `Palette.swift`.
- "Talk test" hotkey: bounce for 3 s and chirp.

### 6.7 Tray menu (port `AppDelegate.swift` menu)
Status (Asleep / Listening / …) · Wake Up and Talk / Go to Sleep · Mood ▸ · Cursor Size ▸ · Trail ▸ · Glow · Show Cursor · Follow Mouse · Captions · Home Position ▸ (Left/Center/Right) · **Let Him Use the Computer** · Personality… · OpenAI Key… · Models… · Hotkeys… · Transcripts… · Start with Windows · Quit.

### 6.8 Transcripts (port `SessionStore.swift`)
Session = start/end time, ordered entries (user turn text, asked flag, assistant reply, research report). Simple viewer window with list + detail; delete session.

---

## 7. Non-functional requirements
- **Privacy:** screenshots are only taken when the model calls `look_at_screen`; never stored on disk unless a debug flag is on. API key encrypted at rest. No telemetry.
- **Safety:** all guardrails in §1.1.8 and §6.3. Prompt text from `computerGuide` included verbatim. Stop hotkey works even while a tool is mid-flight (cancel token checked between steps).
- **Performance:** look_at_screen ≤ 700 ms on a 1440p screen (capture + OCR + UIA in parallel). Mic → server latency ≤ 150 ms per chunk.
- **Robustness:** every external call has a timeout and a friendly bubble on failure. Log to `%LOCALAPPDATA%\GooglyEyes\logs` (no secrets, no screenshots).
- **DPI:** correct at 100/125/150/200 % scaling on the primary monitor.

---

## 8. Phased build plan for Claude Code

Work phase by phase; each phase ends with the listed acceptance check. Commit after each phase.

**Phase 0 — Scaffold**
- `GooglyEyes.sln`, WPF project `net8.0-windows10.0.19041.0`, PerMonitorV2 manifest, tray icon, settings + secrets storage, logging, fonts as resources.
- ✅ Exe launches to tray; OpenAI key dialog saves/loads encrypted.

**Phase 1 — Overlay & character**
- Full-screen click-through overlay excluded from capture; CursorEngine port; trails/glow/size; home widget with FaceRenderer and all moods; hotkeys P/F/D/T/H.
- ✅ Ctrl+Alt+P flies the character to the mouse smoothly; eyes follow the mouse; moods switch from tray; overlay invisible in a Snipping Tool screenshot.

**Phase 2 — Screen reading**
- ScreenCapture, OcrReader (with tiling), ControlsReader (UIA), ScreenSnapshot + targetList; a debug command that dumps targetList and draws boxes over the screen.
- ✅ On Notepad, Chrome, File Explorer and VS Code, ids line up with the real words/controls (visual box overlay matches within ~4 px).

**Phase 3 — Realtime voice + pointing**
- MicCapture, RealtimeSession, prompts, tool schemas, `look_at_screen`, `point_at`, `point_at_spot`, `stop_pointing`, `go_to_sleep`, speech bubble streaming, chirp, choreography, hold-to-ask (Right-Ctrl + mouse-hold on widget), wake/sleep.
- ✅ "What's this?" with mouse over a word → cursor flies to that word, one-line bubble appears next to it, cursor returns home after reading time.

**Phase 4 — Web research**
- WebResearch + report card (loading, preview, expanded, error, sources open in browser).
- ✅ "What's the latest price of X?" → "…doing some research…" bubble, card appears, one-line takeaway.

**Phase 5 — Computer use + guardrails**
- InputSynth, all action tools, password refusal, refused shortcuts, stop hotkey, master toggle, UIPI detection, AppLauncher.
- ✅ "Open Notepad and type hello world" works with visible cursor and real pointer restored; password field refused; Ctrl+Alt+S halts mid-task.

**Phase 6 — Polish & ship**
- Transcripts viewer, Start-with-Windows, personality editor, model settings, error states, single-file publish, optional installer + signing. Optional: `ClaudeBrain` provider.
- ✅ Clean Windows 11 VM: copy exe, run, add key, full demo works with no other installs.

---

## 9. Testing
- Unit tests (xUnit): TimingCurve values, grid conversion, key-combo parser + refusal list, research text cleaning, targetList formatting, target(near:) hit-testing.
- Manual test matrix: 100/150 % DPI; Chrome, Edge, VS Code, Office, Explorer, a UWP app (Calculator); dark/light theme; mic blocked; no key; bad key; network drop mid-session.
- Record a short GIF per phase acceptance check.

---

## 10. Open questions / risks
1. **Licence:** the source repo has **no LICENSE file**, so by default its code is all-rights-reserved. Re-implementing the behaviour is fine for personal use; ask the author before redistributing or commercialising a port, and don't reuse its character art/name commercially without permission.
2. **Model availability/pricing:** `gpt-realtime-2.1` and `gpt-5.5` come from the repo — confirm current names and costs before building; keep them configurable.
3. **OCR quality** on Windows (`Windows.Media.Ocr`) is a bit weaker than Apple Vision on small UI text; tiling at native resolution mitigates it. If insufficient, evaluate PaddleOCR (ONNX) as a pluggable alternative.
4. **Push-to-talk key** choice (Right-Ctrl default) may clash with some apps/games — make it configurable, and support a mouse side-button.
5. **Multi-monitor:** v1 primary only; v2 = capture the monitor under the mouse and extend the grid per monitor.
