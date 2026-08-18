# 🎵 Sync Metronome PWA (iOS & Android Wi-Fi Beat Sync)

A high-precision, sub-millisecond synchronized metronome Progressive Web App (PWA) designed for musicians, bands, orchestras, and drumlines rehearsing over the same Wi-Fi network.

When any device starts, stops, or changes tempo, **all connected devices beat together in perfect synchrony**.

---

## ✨ Key Features

- 📶 **Sub-Millisecond Wi-Fi Synchronization**:
  - Continuous NTP-style clock offset calculation (Cristian's algorithm) compensating for network round-trip time (RTT).
  - Quantized epoch scheduling ensures all devices trigger clicks simultaneously at the exact physical millisecond.
- 🔊 **Precision Web Audio Engine**:
  - Lookahead audio buffer scheduling (`AudioContext.currentTime`) avoiding JavaScript event loop timer jitter.
  - Three distinct sound presets: **Electronic Beep**, **Crisp Woodblock**, and **Snappy Rimshot**.
  - Beat 1 accentuation with higher pitch and volume.
- 📱 **Cross-Platform PWA (iOS & Android)**:
  - **iOS Safari Support**: Automatic AudioContext unlocking and "Add to Home Screen" standalone app mode.
  - **Android Chrome Support**: Instant PWA install banner.
  - **Screen Wake Lock**: Automatically prevents device screens from turning off during practice.
- 🎯 **Visual Metronome & Flash**:
  - High-contrast visual screen flash on beats (great for noisy stages or across the room).
  - Beat ring and live beat counter dots (e.g. 2/4, 3/4, 4/4, 6/8).
  - Tap Tempo with automatic BPM averaging.
  - Fine-tuning steppers (±1, ±5 BPM) and slider (30 – 280 BPM).
- 📲 **1-Click QR Code Sharing**:
  - Built-in Wi-Fi IP detection with a large QR Code for iPhone & Android camera scanning.

---

## 🚀 Getting Started

### 1. Start the Local Sync Hub

Run on your laptop / computer connected to the Wi-Fi:

```bash
# Install dependencies
npm install

# Start server
npm start
```

The terminal will display your local network Wi-Fi address (e.g., `http://192.168.0.149:3000`).

### 2. Connect Your Phones & Tablets

1. Make sure all devices are connected to the **same Wi-Fi network**.
2. Open the URL in your browser or **scan the QR Code** shown on the host device by tapping the **QR button** at the top right.
3. Open the app on each phone, tap the screen to activate audio, and press **START SYNC**!

---

## 📱 Installing to Home Screen (PWA)

- **iOS (iPhone/iPad)**:
  1. Open Safari and navigate to your server's Wi-Fi address.
  2. Tap the **Share button** (square with an arrow pointing up).
  3. Scroll down and tap **"Add to Home Screen"**.
- **Android (Chrome)**:
  1. Open Chrome and navigate to the Wi-Fi address.
  2. Tap the **three dots menu (⋮)** or the prompt **"Install app"**.

---

## 🛠️ Project Structure

```text
sync-metronome - PWA/
├── server.js              # Node.js WebSocket hub & NTP sync server
├── package.json           # Dependencies (Express, ws, qrcode)
├── public/
│   ├── index.html         # Responsive metronome UI & PWA layout
│   ├── manifest.json      # Web App Manifest
│   ├── sw.js              # Service Worker for offline caching
│   ├── css/
│   │   └── style.css      # Dark glassmorphism styling & animations
│   ├── js/
│   │   ├── audio.js       # Web Audio API synthesizer & scheduler
│   │   ├── sync.js        # NTP clock synchronization engine
│   │   └── app.js         # UI controller, Tap Tempo, Wake Lock
│   └── icons/
│       └── icon.svg       # App icon
└── scripts/
    └── test_sync.js       # Automated test suite
```
