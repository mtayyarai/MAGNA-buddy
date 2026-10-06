# Build history

Each row is a signed-off .exe build. Later builds in `builds/` are kept so
you can roll back without rebuilding.

| Version | Installer                             | Date (UTC)             | Highlights |
|---------|---------------------------------------|------------------------|------------|
| 0.1.0   | `builds/MAGNA-Buddy-Setup-0.1.0.exe`   | 2026-10-06 ~14:30      | Phase 0 scaffold: tray + encrypted OpenAI key dialog + settings. |
| 0.1.1   | *(overwrote 0.1.0)*                   | 2026-10-06 ~14:45      | On-screen character widget (frameless, blueberry googly-eyes, 180px, bottom-right). |
| 0.1.2   | *(overwrote 0.1.1)*                   | 2026-10-06 ~15:02      | Press-and-hold → mic → Whisper → Chat Completions. Speech bubble. Drag anywhere. 90px widget. |
| 0.2.0   | *(overwrote 0.1.2)*                   | 2026-10-06 ~15:19      | Computer-use: function-calling + `open_url`, `open_app`, `type_text`, `press_keys`, `click_at`, `scroll_at`. Blue AI cursor overlay. Dangerous-combo guardrails. |
| 0.2.1   | *(overwrote 0.2.0)*                   | 2026-10-06 ~15:27      | Swap voice path to OpenAI Realtime API (`gpt-4o-mini-realtime-preview`), text-only, 24 kHz PCM16 pipeline. BOM-tolerant settings loader. |
| 0.3.0   | `builds/MAGNA-Buddy-Setup-0.3.0.exe`   | 2026-10-06 ~15:34      | Instant-feedback press-to-talk (no 140 ms arm delay). Mic + WebSocket opened in parallel. Realtime WS awaits connect before accepting audio. Versioned installer kept in `builds/`. |
| 0.4.0   | `builds/MAGNA-Buddy-Setup-0.4.0.exe`   | 2026-10-06 ~15:41      | Dropped `OpenAI-Beta: realtime=v1` header. Realtime model dropdown with pricing. Default `gpt-realtime-2.1-mini`. (Session shape still beta — fixed in 0.4.1.) |
| 0.4.1   | `builds/MAGNA-Buddy-Setup-0.4.1.exe`   | 2026-10-06 ~15:43      | **GA session.update shape**: `session.type: "realtime"`, `output_modalities`, `audio.input.{format,transcription,turn_detection}`. `response.create` uses `output_modalities`. Fixes `beta_api_shape_disabled` error. First version that actually opened YouTube end-to-end from voice. |
| 0.4.2   | `builds/MAGNA-Buddy-Setup-0.4.2.exe`   | 2026-10-06 ~15:48      | AI cursor flies with a labelled badge before every tool, pauses ~700 ms, then acts. Bubble click-selectable + `copy` button. Empty audio buffers rejected locally. |
| 0.4.3   | `builds/MAGNA-Buddy-Setup-0.4.3.exe`   | 2026-10-06 ~15:56      | AI cursor is now a mini blueberry character matching the home widget. Procedural sound effects on press/release/landing/response. |
| 0.4.4   | `builds/MAGNA-Buddy-Setup-0.4.4.exe`   | 2026-10-06 ~16:05      | AI cursor now visibly flies out of the home-widget character; longer 820 ms flight; `npm run dist:mac` config added. |
| 0.4.5   | `builds/MAGNA-Buddy-Setup-0.4.5.exe`   | 2026-10-06 ~16:08      | Multi-step tool chaining; new `web_search` tool; sticky bubble with ◀ history ▶. |
| 0.4.6   | `builds/MAGNA-Buddy-Setup-0.4.6.exe`   | 2026-10-06 ~16:15      | Magna brand palette (red + green + "M" badge). Tray/installer icons regenerated. |
| 0.5.0   | `builds/MAGNA-Buddy-Setup-0.5.0.exe`   | 2026-10-06 ~16:24      | App renamed to **MAGNA Buddy**. One-time migration from `%APPDATA%\googly-eyes\`. Magna wordmark on belly; 3-stop red/green body. New `wait` tool + strengthened multi-step prompt. First commit on `github.com/mtayyarai/MAGNA-buddy`. |
| 0.5.1   | `builds/MAGNA-Buddy-Setup-0.5.1.exe`   | 2026-10-06 ~16:30      | "Cute blue" palette; AI cursor logo-free; tray/installer icons in blue. |
| 0.5.2   | `builds/MAGNA-Buddy-Setup-0.5.2.exe`   | 2026-10-06 ~16:34      | Settings → character colour picker with 10 presets + custom hex; live-apply on home + AI cursor; logo smaller + centred under the eyes. |
| 0.5.3   | `builds/MAGNA-Buddy-Setup-0.5.3.exe`   | 2026-10-06 ~16:36      | Screen vision — new `look_at_screen` tool captures primary monitor, injects as `input_image` into realtime; overlays content-protected + hidden during capture. |
| 0.5.4   | `builds/MAGNA-Buddy-Setup-0.5.4.exe`   | 2026-10-06 ~16:46      | Logo in rounded-square badge; app icon = MAGNA logo via jimp-resampled multi-size ICO; global push-to-talk hotkey (Alt+M); periodic AI updates every 5 min. |
| 0.5.5   | `builds/MAGNA-Buddy-Setup-0.5.5.exe`   | 2026-10-06 ~16:49      | Logo badge tightened + dropped lower (plate 46%→32%, pad 7-9%→2.5%, bottom 3%→-1%). |
| 0.5.6   | `builds/MAGNA-Buddy-Setup-0.5.6.exe`   | *(current)*            | **App icon fills more of the canvas** — reduced the transparent padding in `scripts/make-icons.js` from 6% to 2%, so the Magna "M" is substantially larger in the tray, taskbar, Alt-Tab chooser, and installer window. |
