# SyncBeat Offline PWA

SyncBeat is an installable metronome for iOS and Android. Devices synchronize
directly over the same Wi-Fi network or phone hotspot using WebRTC data
channels. Beat events do not use MQTT, a cloud sync service, a LAN computer, or
a Node.js WebSocket server.

## Install once, use offline

1. While internet access is available, open the GitHub Pages deployment.
2. Android: choose **Install app** in Chrome.
3. iOS: open in Safari, choose **Share > Add to Home Screen**.
4. Launch the installed app once so its offline files are cached.
5. At rehearsal, connect every device to the same Wi-Fi/hotspot. Internet
   access is not required.

The public website is used only to install and update the static PWA. During a
session, pairing and metronome data remain between the devices.

## Pair devices without a server

1. On one device, open the QR panel and choose **Create room**.
2. On a second device, choose **Join**, then scan the host's invitation QR.
3. The joining device displays a response QR. Let the host scan that response.
4. Repeat **Add another device** on the host for each additional phone/tablet.

Copy/paste pairing codes are available when camera permission is unavailable.
The two-way exchange replaces the signalling server normally used by WebRTC.

## Important limitations

- All participants must be on the same LAN; guest/client isolation must be off.
- Pairing must be repeated after closing the peer connection or restarting the
  PWA. Browsers do not allow a PWA to host a discoverable LAN server.
- Camera access, PWA installation, and service workers require HTTPS. GitHub
  Pages provides HTTPS; the local preview server is intended only for desktop
  development on localhost.
- A hotspot may prevent attached clients from communicating with one another.
  The host-and-spoke layout only requires each guest to reach the host device,
  but hotspot behavior still varies by OS and vendor.

## Development

Run npm install, then npm start, and open http://localhost:3000.

The Node process serves static files for local preview only and does not
participate in synchronization.

## Structure

- public/js/sync.js — WebRTC star topology, clock calibration, beat events
- public/js/app.js — UI, QR pairing, camera scanning
- public/js/audio.js — Web Audio lookahead scheduler
- public/sw.js — offline application cache
- docs/ — GitHub Pages deployment copy
