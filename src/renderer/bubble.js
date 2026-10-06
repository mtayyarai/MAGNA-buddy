'use strict';

const bubble   = document.getElementById('bubble');
const userEl   = document.getElementById('userText');
const replyEl  = document.getElementById('replyText');
const copyBtn  = document.getElementById('copyBtn');
const prevBtn  = document.getElementById('prevBtn');
const nextBtn  = document.getElementById('nextBtn');
const closeBtn = document.getElementById('closeBtn');
const counter  = document.getElementById('counter');

let currentReply = '';
let lastSoundAt = 0;

// --- Procedural "done" chirp when a new reply arrives ---------------------
let outCtx = null;
function playDoneChirp() {
  const now = performance.now();
  if (now - lastSoundAt < 350) return;
  lastSoundAt = now;
  try {
    if (!outCtx) outCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = outCtx.currentTime;
    const osc = outCtx.createOscillator();
    const gain = outCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(1320, t + 0.07);
    osc.frequency.linearRampToValueAtTime(1760, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain); gain.connect(outCtx.destination);
    osc.start(t); osc.stop(t + 0.22);
  } catch {}
}

// --- Render a payload { reply, user, historyIndex, historyCount } ---------
if (window.api?.onBubble) {
  window.api.onBubble((p) => {
    const data = p || {};
    const reply = data.reply || '';
    const user  = data.user  || '';
    const idx   = typeof data.historyIndex === 'number' ? data.historyIndex : -1;
    const count = typeof data.historyCount === 'number' ? data.historyCount : 0;

    const isNew = reply !== currentReply;
    currentReply = reply;

    userEl.textContent  = user;
    replyEl.textContent = reply;

    // Nav state
    if (count > 0 && idx >= 0) {
      counter.textContent = `${idx + 1} / ${count}`;
      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= count - 1;
    } else {
      counter.textContent = '—';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }

    copyBtn.classList.remove('copied');
    copyBtn.textContent = 'copy';

    bubble.classList.remove('visible');
    void bubble.offsetWidth;
    requestAnimationFrame(() => bubble.classList.add('visible'));

    if (isNew && reply) playDoneChirp();
  });
}

if (window.api?.onBubbleHide) {
  window.api.onBubbleHide(() => {
    bubble.classList.remove('visible');
  });
}

// Interactive on hover (window is otherwise click-through).
bubble.addEventListener('mouseenter', () => { try { window.api.bubbleSetIgnore(false); } catch {} });
bubble.addEventListener('mouseleave', () => { try { window.api.bubbleSetIgnore(true);  } catch {} });

prevBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  try { window.api.bubbleNavigate('prev'); } catch {}
});
nextBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  try { window.api.bubbleNavigate('next'); } catch {}
});
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  try { window.api.bubbleClose(); } catch {}
});

copyBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await navigator.clipboard.writeText(currentReply);
    copyBtn.textContent = 'copied';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'copy';
      copyBtn.classList.remove('copied');
    }, 1500);
  } catch (err) {
    copyBtn.textContent = 'failed';
    setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500);
  }
});

// Keyboard shortcuts when the bubble has focus
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  { try { window.api.bubbleNavigate('prev'); } catch {} }
  if (e.key === 'ArrowRight') { try { window.api.bubbleNavigate('next'); } catch {} }
  if (e.key === 'Escape')     { try { window.api.bubbleClose(); } catch {} }
});
