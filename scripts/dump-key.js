// One-shot helper: decrypt the saved OpenAI key using the same safeStorage
// path the app uses, then print it to stdout. Only intended for local testing.
'use strict';

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Make sure userData resolves to the same folder the packaged app uses.
app.setName('magna-buddy');

// Second arg (after script path) is the output file.
const outFile = process.argv[process.argv.length - 1];

app.whenReady().then(() => {
  const keyPath = path.join(app.getPath('userData'), 'keys.bin');
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(outFile, 'ERR:no-keys-bin');
    app.exit(2);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(outFile, 'ERR:safeStorage-unavailable');
    app.exit(3);
    return;
  }
  try {
    const data = fs.readFileSync(keyPath);
    const key = safeStorage.decryptString(data);
    fs.writeFileSync(outFile, key);
    app.exit(0);
  } catch (e) {
    fs.writeFileSync(outFile, 'ERR:' + e.message);
    app.exit(4);
  }
});
