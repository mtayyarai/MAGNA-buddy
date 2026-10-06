'use strict';

const el    = document.getElementById('c');
const label = document.getElementById('label');
const pupils = document.querySelectorAll('.ai-pupil');

let hideTimer = null;
let landTimer = null;
let lastX = 0, lastY = 0;

// --- Procedural landing chirp ---------------------------------------------
let actx = null;
function playLandChirp() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain); gain.connect(actx.destination);
    osc.start(t); osc.stop(t + 0.14);
  } catch {}
}

// --- Visual helpers --------------------------------------------------------
function pingOnce() {
  el.classList.remove('pinging');
  void el.offsetWidth;
  el.classList.add('pinging');
}
function landOnce() {
  el.classList.remove('landing');
  void el.offsetWidth;
  el.classList.add('landing');
  clearTimeout(landTimer);
  landTimer = setTimeout(() => el.classList.remove('landing'), 450);
}
function aimPupils(dx, dy) {
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  const left = 30 + nx * 16;
  const top  = 32 + ny * 16;
  for (const p of pupils) {
    p.style.left = `${left}%`;
    p.style.top  = `${top}%`;
  }
}
function teleportTo(x, y) {
  el.classList.add('no-anim');
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  void el.offsetWidth; // force reflow so the next change actually animates
  el.classList.remove('no-anim');
}

// --- Fly event handler -----------------------------------------------------
if (window.api && window.api.onAiCursorFly) {
  window.api.onAiCursorFly(({ x, y, fromX, fromY, labelText, dwellMs }) => {
    const isHidden = !el.classList.contains('visible');

    // If the cursor is currently off-screen, "spawn" it at the character
    // widget (fromX,fromY) with no transition, so the subsequent move to
    // (x,y) is visibly animated.
    if (isHidden && typeof fromX === 'number' && typeof fromY === 'number') {
      teleportTo(fromX, fromY);
      aimPupils(x - fromX, y - fromY);
      lastX = fromX; lastY = fromY;
    } else {
      aimPupils(x - lastX, y - lastY);
    }

    el.classList.add('visible');

    // Set label alongside the character.
    if (labelText && labelText.length > 0) {
      label.textContent = labelText;
      el.classList.add('labelled');
    } else {
      el.classList.remove('labelled');
      label.textContent = '';
    }

    // Fire the actual flight on the next paint so the browser applies the
    // start position first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.left = `${x}px`;
        el.style.top  = `${y}px`;
      });
    });
    lastX = x; lastY = y;

    // Arrive: ping + bounce + sfx after the CSS transition finishes.
    setTimeout(() => {
      pingOnce();
      landOnce();
      playLandChirp();
    }, 860);

    clearTimeout(hideTimer);
    const totalMs = Math.max(1800, dwellMs || 3200);
    hideTimer = setTimeout(() => {
      el.classList.remove('visible');
      el.classList.remove('labelled');
    }, totalMs);
  });
}
