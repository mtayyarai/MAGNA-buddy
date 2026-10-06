'use strict';

const $ = (sel) => document.querySelector(sel);
let settings = null;

const MODEL_PRICING = {
  'gpt-live-1':             'Flat ~$0.05/min. Full-duplex voice (can listen + speak simultaneously). Reasoning + tool-use handled by a separate backend.',
  'gpt-realtime-2.1':       'Audio: $32 input / $64 output per 1M tokens. Text: $4 input / $24 output per 1M. Native tool-use + reasoning. Expensive but most capable.',
  'gpt-realtime-2.1-mini':  'Cheaper, faster variant of 2.1 — recommended default for push-to-talk assistants.',
  'gpt-realtime-2':         'Previous generation (launched May 2026). Keep if the new ones misbehave on your prompt.',
  'gpt-realtime-1.5':       'Older audio-in / audio-out model. Lowest capability but very stable.',
  'gpt-realtime-translate': 'Live speech translation only. ~$0.034/min. Use only if the "assistant" is a translator.'
};

function refreshPricing() {
  const el = document.getElementById('modelPricing');
  const sel = document.getElementById('realtimeModel');
  el.textContent = MODEL_PRICING[sel.value] || '';
}

(async () => {
  settings = await window.api.getSettings();
  // If saved value isn't one of the dropdown options, add it so we can still display + save it.
  const sel = $('#realtimeModel');
  const saved = settings.realtimeModel ?? '';
  if (saved && ![...sel.options].some((o) => o.value === saved)) {
    const o = document.createElement('option');
    o.value = saved;
    o.textContent = `${saved} (custom)`;
    sel.appendChild(o);
  }
  sel.value = saved || sel.options[0].value;
  sel.addEventListener('change', refreshPricing);
  refreshPricing();

  // --- character colour ---
  const colorPicker = $('#colorPicker');
  const colorPreset = $('#colorPreset');
  const savedColor = (settings.characterColor || '#4a8ee0').toLowerCase();
  colorPicker.value = savedColor;
  const presetMatch = [...colorPreset.options].find((o) => o.value.toLowerCase() === savedColor);
  colorPreset.value = presetMatch ? presetMatch.value : 'custom';
  colorPreset.addEventListener('change', () => {
    if (colorPreset.value !== 'custom') colorPicker.value = colorPreset.value;
  });
  colorPicker.addEventListener('input', () => {
    const v = colorPicker.value.toLowerCase();
    const match = [...colorPreset.options].find((o) => o.value.toLowerCase() === v);
    colorPreset.value = match ? match.value : 'custom';
  });

  $('#transcribeModel').value  = settings.transcribeModel  ?? '';
  $('#researchModel').value    = settings.researchModel    ?? '';
  $('#homePosition').value     = settings.homePosition     ?? 'center';
  $('#cursorSize').value       = settings.cursorSize       ?? 72;
  $('#captions').checked       = !!settings.captions;
  $('#followMouse').checked    = !!settings.followMouse;
  $('#allowComputerUse').checked = !!settings.allowComputerUse;
  $('#startWithWindows').checked = !!settings.startWithWindows;
  $('#pushToTalkKey').value       = settings.pushToTalkKey ?? 'Alt+M';
  $('#periodicAiNews').checked    = settings.periodicAiNews !== false;
  $('#periodicIntervalMinutes').value = settings.periodicIntervalMinutes ?? 5;
  $('#personality').value      = settings.personality      ?? '';
  $('#hotkeys').textContent = Object.entries(settings.hotkeys || {})
    .map(([k, v]) => `${k.padEnd(14)}  ${v}`)
    .join('\n');
})();

$('#saveBtn').addEventListener('click', async () => {
  const cursorSize = Math.max(48, Math.min(120, parseInt($('#cursorSize').value, 10) || 72));
  const next = {
    ...settings,
    realtimeModel:    $('#realtimeModel').value.trim() || 'gpt-realtime-2.1-mini',
    characterColor:   $('#colorPicker').value || '#4a8ee0',
    transcribeModel:  $('#transcribeModel').value.trim(),
    researchModel:    $('#researchModel').value.trim(),
    homePosition:     $('#homePosition').value,
    cursorSize,
    captions:         $('#captions').checked,
    followMouse:      $('#followMouse').checked,
    allowComputerUse: $('#allowComputerUse').checked,
    startWithWindows: $('#startWithWindows').checked,
    personality:      $('#personality').value,
    pushToTalkKey:    $('#pushToTalkKey').value.trim(),
    periodicAiNews:   $('#periodicAiNews').checked,
    periodicIntervalMinutes: Math.max(1, Math.min(240, parseInt($('#periodicIntervalMinutes').value, 10) || 5))
  };
  const ok = await window.api.saveSettings(next);
  if (ok) window.api.closeWindow();
  else alert('Save failed — check logs.');
});

$('#cancelBtn').addEventListener('click', () => window.api.closeWindow());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeWindow();
});
