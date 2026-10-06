'use strict';

// ===== Elements ===========================================================
const hitbox   = document.getElementById('hitbox');
const leftEye  = document.querySelector('.eye.left');
const rightEye = document.querySelector('.eye.right');
const pupils   = document.querySelectorAll('.pupil');

// ===== Character color (user-selectable) =================================
function applyBodyColor(hex) {
  if (!window.MagnaPalette || !hex) return;
  const grad = window.MagnaPalette.bodyGradient(hex);
  // Only paint the idle gradient — listening (green) and thinking (orange)
  // stay as hardcoded states so the user still gets a clear status signal.
  hitbox.style.setProperty('background', grad.trim(), 'important');
}

(async function initColor() {
  try {
    const s = await window.api.getSettings();
    if (s && s.characterColor) applyBodyColor(s.characterColor);
  } catch {}
})();

if (window.api && window.api.onSettingsChanged) {
  window.api.onSettingsChanged((s) => {
    if (s && s.characterColor && state !== 'listening' && state !== 'thinking') {
      applyBodyColor(s.characterColor);
    }
  });
}

// ===== Sound effects (Web Audio, procedural) ==============================
let outCtx = null;
function sfxCtx() {
  if (!outCtx) {
    try { outCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { outCtx = null; }
  }
  return outCtx;
}
function sfx(kind) {
  const c = sfxCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);

  switch (kind) {
    case 'start': {       // rising chirp — mic opened
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.exponentialRampToValueAtTime(1050, now + 0.13);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.start(now); osc.stop(now + 0.2);
      break;
    }
    case 'end': {         // falling chirp — user released, sending
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1050, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.start(now); osc.stop(now + 0.2);
      break;
    }
    case 'cancel': {      // short low thud
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.start(now); osc.stop(now + 0.12);
      break;
    }
  }
}

// ===== State ==============================================================
const DRAG_THRESHOLD   = 6;   // px before a press becomes a drag
const LISTEN_START_MS  = 0;   // start listening the moment the click lands
const MIN_RECORD_MS    = 200; // discard releases faster than this (accidental taps)

let state = 'idle';          // 'idle' | 'listening' | 'thinking' | 'speaking'
let press = null;            // { startX, startY, startTime, armTimer, pointerId }
let dragging = false;

// Realtime audio
let audioCtx = null;
let audioStream = null;
let audioWorkletNode = null;
let audioSourceNode = null;
let recordingStartedAt = 0;

function setState(next) {
  state = next;
  document.body.classList.remove('idle', 'listening', 'thinking', 'speaking', 'dragging');
  if (next) document.body.classList.add(next);
}
setState('idle');

// ===== Pupil follows the real cursor ======================================
if (window.api && window.api.onCursor) {
  window.api.onCursor(({ x, y, wx, wy }) => {
    if (state === 'listening' || state === 'thinking') return;
    const dx = x - wx, dy = y - wy;
    const dist = Math.hypot(dx, dy) || 1;
    const maxOffset = 22;
    const nx = dx / dist, ny = dy / dist;
    const amt = Math.min(1, dist / 220);
    const left = 29 + nx * maxOffset * amt;
    const top  = 29 + ny * maxOffset * amt;
    for (const p of pupils) { p.style.left = `${left}%`; p.style.top = `${top}%`; }
  });
}

// ===== Blink randomly =====================================================
function blinkOnce() {
  [leftEye, rightEye].forEach((eye) => {
    eye.classList.remove('blinking');
    void eye.offsetWidth;
    eye.classList.add('blinking');
  });
}
function scheduleBlink() {
  const delay = 2500 + Math.random() * 4500;
  setTimeout(() => { blinkOnce(); scheduleBlink(); }, delay);
}
scheduleBlink();

// ===== Press-to-talk + drag ==============================================
hitbox.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state !== 'idle') return;
  try { hitbox.setPointerCapture(e.pointerId); } catch {}
  press = {
    startX: e.screenX,
    startY: e.screenY,
    startTime: Date.now(),
    pointerId: e.pointerId,
    armTimer: setTimeout(armListening, LISTEN_START_MS)
  };
});

hitbox.addEventListener('pointermove', (e) => {
  if (!press || dragging) return;
  const dx = e.screenX - press.startX;
  const dy = e.screenY - press.startY;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    dragging = true;
    clearTimeout(press.armTimer);
    if (state === 'listening') cancelListening();
    setState('idle');
    document.body.classList.add('dragging');
    try { window.api.widgetBeginDrag(); } catch {}
  }
});

hitbox.addEventListener('pointerup', (e) => {
  if (!press) return;
  clearTimeout(press.armTimer);
  try { hitbox.releasePointerCapture(e.pointerId); } catch {}

  const wasDrag = dragging;
  const wasListening = state === 'listening';
  press = null;
  dragging = false;
  document.body.classList.remove('dragging');

  if (wasDrag) {
    try { window.api.widgetEndDrag(); } catch {}
  } else if (wasListening) {
    stopAndSubmit();
  } else {
    blinkOnce();
  }
});

hitbox.addEventListener('pointercancel', () => {
  if (press) { clearTimeout(press.armTimer); press = null; }
  if (dragging) { try { window.api.widgetEndDrag(); } catch {} dragging = false; }
  if (state === 'listening') cancelListening();
  document.body.classList.remove('dragging');
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  try { window.api.widgetContextMenu(); } catch {}
});
window.addEventListener('dragstart', (e) => e.preventDefault());

// Global push-to-talk hotkey — press once to start, press again to send.
if (window.api && window.api.onHotkeyToggleTalk) {
  window.api.onHotkeyToggleTalk(() => {
    if (state === 'idle') armListening();
    else if (state === 'listening') stopAndSubmit();
  });
}

// ===== Realtime audio pipeline ===========================================
async function armListening() {
  if (state !== 'idle') return;

  // Instant visual feedback — the user sees green the moment they click.
  setState('listening');
  recordingStartedAt = Date.now();
  sfx('start');

  // Key check (bail if missing; opens the key dialog).
  try {
    const has = await window.api.hasKey();
    if (!has) {
      try { window.api.widgetOpenApiKey(); } catch {}
      setState('idle');
      return;
    }
  } catch {}
  if (state !== 'listening') return; // user released during check

  // Open mic + WebSocket in parallel to minimise cold-start latency.
  const micP = navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  }).catch((e) => { console.error('mic denied', e); return null; });

  const wsP = window.api.realtimeStart().catch(() => false);

  const [stream, opened] = await Promise.all([micP, wsP]);

  if (!stream || !opened || state !== 'listening') {
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    if (!opened) try { window.api.realtimeCancel(); } catch {}
    if (state === 'listening') setState('idle');
    return;
  }

  audioStream = stream;

  try {
    audioCtx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
  } catch {
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
  }

  try {
    await audioCtx.audioWorklet.addModule('audio-worklet.js');
  } catch (e) {
    console.error('audio worklet add failed', e);
    teardownAudio();
    try { window.api.realtimeCancel(); } catch {}
    setState('idle');
    return;
  }

  if (state !== 'listening') {
    teardownAudio();
    try { window.api.realtimeCancel(); } catch {}
    return;
  }

  audioSourceNode = audioCtx.createMediaStreamSource(audioStream);
  audioWorkletNode = new AudioWorkletNode(audioCtx, 'pcm-worklet');
  audioWorkletNode.port.onmessage = (ev) => {
    try { window.api.realtimeAudioChunk(ev.data); } catch {}
  };
  audioSourceNode.connect(audioWorkletNode);
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  audioWorkletNode.connect(sink).connect(audioCtx.destination);
}

function teardownAudio() {
  try { audioWorkletNode && audioWorkletNode.disconnect(); } catch {}
  try { audioSourceNode && audioSourceNode.disconnect(); } catch {}
  try { audioStream && audioStream.getTracks().forEach(t => t.stop()); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  audioWorkletNode = null;
  audioSourceNode = null;
  audioStream = null;
  audioCtx = null;
}

function cancelListening() {
  teardownAudio();
  try { window.api.realtimeCancel(); } catch {}
  sfx('cancel');
  setState('idle');
}

async function stopAndSubmit() {
  const held = Date.now() - recordingStartedAt;
  if (held < MIN_RECORD_MS) {
    cancelListening();
    return;
  }
  // Flush pending audio by giving the worklet one more scheduling pass.
  await new Promise((r) => setTimeout(r, 60));
  teardownAudio();

  setState('thinking');
  sfx('end');
  try { window.api.realtimeCommit(); } catch {}

  // Main will stream text into the bubble; we return to idle after a short cosmetic delay.
  setTimeout(() => {
    if (state === 'thinking') setState('speaking');
    setTimeout(() => { if (state === 'speaking') setState('idle'); }, 2000);
  }, 600);
}
