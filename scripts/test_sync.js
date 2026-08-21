const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'public/index.html',
  'public/js/audio.js',
  'public/js/sync.js',
  'public/js/app.js',
  'public/js/qrcode.min.js',
  'public/js/jsQR.js',
  'public/sw.js',
  'public/manifest.json'
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error('Missing asset: ' + relative);
}

const syncSource = fs.readFileSync(path.join(root, 'public/js/sync.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');

if (/mqtt|broker\.emqx|WebSocket\(/i.test(syncSource + html + sw)) {
  throw new Error('Cloud/WebSocket transport is still referenced by the PWA.');
}
if (!syncSource.includes('iceServers: []')) throw new Error('WebRTC is not restricted to LAN ICE candidates.');
if (!html.includes('./js/jsQR.js')) throw new Error('Offline QR scanner is not loaded.');
if (!sw.includes('./js/jsQR.js')) throw new Error('Offline QR scanner is not cached.');

console.log('Offline WebRTC PWA checks passed.');
