'use strict';

const $ = (sel) => document.querySelector(sel);
const input      = $('#keyInput');
const statusEl   = $('#status');
const toggleBtn  = $('#toggleShow');

(async () => {
  try {
    const existing = await window.api.getKey();
    if (existing) {
      input.value = existing;
      statusEl.textContent = 'Loaded saved key.';
    }
  } catch (e) {
    statusEl.textContent = `Load failed: ${e.message}`;
  }
  input.focus();
})();

toggleBtn.addEventListener('click', () => {
  if (input.type === 'password') {
    input.type = 'text';
    toggleBtn.textContent = 'Hide';
  } else {
    input.type = 'password';
    toggleBtn.textContent = 'Show';
  }
  input.focus();
});

$('#testBtn').addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) { statusEl.textContent = 'Paste a key first.'; return; }
  statusEl.textContent = 'Testing…';
  try {
    const r = await window.api.testKey(key);
    if (r.ok) {
      statusEl.textContent = 'OK — key accepted by api.openai.com.';
    } else if (r.status === 0) {
      statusEl.textContent = `Network error: ${(r.body || '').slice(0, 160)}`;
    } else {
      statusEl.textContent = `Rejected (${r.status}). ${(r.body || '').replace(/\s+/g, ' ').slice(0, 160)}`;
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});

$('#saveBtn').addEventListener('click', doSave);

async function doSave() {
  const key = input.value.trim();
  if (!key) { statusEl.textContent = 'Please paste a key first.'; return; }
  if (!(key.startsWith('sk-') || key.startsWith('sess-'))) {
    if (!confirm("That key doesn't look like a standard OpenAI key (expected to start with 'sk-'). Save anyway?")) return;
  }
  const ok = await window.api.saveKey(key);
  if (ok) {
    statusEl.textContent = 'Saved.';
    window.api.closeWindow();
  } else {
    statusEl.textContent = 'Save failed — check logs.';
  }
}

$('#clearBtn').addEventListener('click', async () => {
  if (!confirm('Remove the saved OpenAI key from this machine?')) return;
  await window.api.clearKey();
  input.value = '';
  statusEl.textContent = 'Cleared.';
});

$('#cancelBtn').addEventListener('click', () => window.api.closeWindow());

$('#openSite').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://platform.openai.com/api-keys');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeWindow();
  if (e.key === 'Enter'  && document.activeElement === input) doSave();
});
