const fs = require('fs');
const path = require('path');

// 1x1 base PNG buffer or simple generated PNG
const minimalPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), minimalPng);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), minimalPng);
console.log('PWA icon placeholders created.');
