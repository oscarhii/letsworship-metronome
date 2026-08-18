document.addEventListener('DOMContentLoaded', () => {
  const audio = new MetronomeAudioEngine();
  const sync = new MetronomeSyncEngine(audio);

  // URL parameters helper
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = urlParams.get('room') || 'MAIN';
  const initialMode = urlParams.get('mode') || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'local' : 'cloud');

  // DOM Elements
  const bpmDisplay = document.getElementById('bpm-display');
  const tempoMarking = document.getElementById('tempo-marking');
  const tempoSlider = document.getElementById('tempo-slider');
  const btnPlay = document.getElementById('btn-play-sync');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const dialProgress = document.getElementById('dial-progress');
  const beatDotsContainer = document.getElementById('beat-dots');
  const flashOverlay = document.getElementById('flash-overlay');

  const btnMinus1 = document.getElementById('btn-minus-1');
  const btnPlus1 = document.getElementById('btn-plus-1');
  const btnMinus5 = document.getElementById('btn-minus-5');
  const btnPlus5 = document.getElementById('btn-plus-5');
  const btnTapTempo = document.getElementById('btn-tap-tempo');

  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const roomBadge = document.getElementById('room-badge');

  const networkModeSelect = document.getElementById('network-mode-select');
  const soundSelect = document.getElementById('sound-select');
  const delaySlider = document.getElementById('delay-slider');
  const delayValLabel = document.getElementById('delay-val-label');
  const beatsSelectButtons = document.querySelectorAll('.segment-btn');
  const flashToggle = document.getElementById('flash-toggle');
  const wakeLockToggle = document.getElementById('wakelock-toggle');

  const btnQrModal = document.getElementById('btn-qr-modal');
  const qrModal = document.getElementById('qr-modal');
  const btnCloseQr = document.getElementById('btn-close-qr');
  const qrcodeContainer = document.getElementById('qrcode-canvas-container');
  const wifiUrlInput = document.getElementById('wifi-url-input');
  const btnCopyUrl = document.getElementById('btn-copy-url');

  const audioUnlockBanner = document.getElementById('audio-unlock-banner');

  let tapTimes = [];
  let wakeLockSentinel = null;

  roomBadge.textContent = `Room: ${initialRoom} ✎`;
  networkModeSelect.value = initialMode;

  // Get exact full base URL (handles GitHub Pages repo subpaths)
  function getAppBaseUrl() {
    let url = window.location.href.split('?')[0].split('#')[0];
    if (!url.endsWith('/') && !url.endsWith('.html')) {
      url += '/';
    }
    return url;
  }

  // Tempo markings dictionary
  function getTempoMarking(bpm) {
    if (bpm < 45) return 'Grave';
    if (bpm < 60) return 'Largo';
    if (bpm < 66) return 'Larghetto';
    if (bpm < 76) return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 156) return 'Allegro';
    if (bpm < 176) return 'Vivace';
    if (bpm < 200) return 'Presto';
    return 'Prestissimo';
  }

  // Update visual UI state
  function updateUI() {
    const bpm = sync.bpm;
    bpmDisplay.textContent = bpm;
    tempoSlider.value = bpm;
    tempoMarking.textContent = getTempoMarking(bpm);

    // Update circular SVG gauge
    const minBpm = 30;
    const maxBpm = 280;
    const percent = (bpm - minBpm) / (maxBpm - minBpm);
    const circumference = 2 * Math.PI * 90;
    dialProgress.style.strokeDashoffset = circumference * (1 - percent);

    // Update play button
    if (sync.isPlaying) {
      btnPlay.classList.add('playing');
      playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>`;
      playText.textContent = 'STOP SYNC';
    } else {
      btnPlay.classList.remove('playing');
      playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
      playText.textContent = 'START SYNC';
      clearActiveDots();
    }

    renderBeatDots();
  }

  // Render beat dots
  function renderBeatDots() {
    const count = sync.beatsPerMeasure;
    beatDotsContainer.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const dot = document.createElement('div');
      dot.className = `beat-dot ${i === 1 ? 'accent-spot' : ''}`;
      dot.dataset.beat = i;
      beatDotsContainer.appendChild(dot);
    }
  }

  function clearActiveDots() {
    const dots = beatDotsContainer.querySelectorAll('.beat-dot');
    dots.forEach((dot) => dot.classList.remove('active'));
  }

  // Beat tick callback for visual animations
  sync.onBeat = (beatNumber, isAccent) => {
    const dots = beatDotsContainer.querySelectorAll('.beat-dot');
    dots.forEach((dot, idx) => {
      if (idx + 1 === beatNumber) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });

    if (flashToggle.checked) {
      flashOverlay.className = isAccent ? 'flashing accent' : 'flashing';
      setTimeout(() => {
        flashOverlay.className = '';
      }, 70);
    }
  };

  sync.onStateChange = () => {
    updateUI();
  };

  sync.onConnectionChange = (connected, deviceCount, rtt, mode) => {
    if (connected) {
      statusPill.classList.add('connected');
      const rttStr = rtt > 0 ? ` • ${rtt}ms` : '';
      const modeLabel = mode === 'local' ? 'LAN' : 'Cloud';
      statusText.textContent = `Synced (${modeLabel} • ${deviceCount} dev)${rttStr}`;
    } else {
      statusPill.classList.remove('connected');
      statusText.textContent = 'Connecting...';
    }
  };

  // Tempo Steppers
  function changeTempo(delta) {
    const newBpm = Math.min(280, Math.max(30, sync.bpm + delta));
    sync.sendTempo(newBpm);
    updateUI();
  }

  btnMinus1.addEventListener('click', () => changeTempo(-1));
  btnPlus1.addEventListener('click', () => changeTempo(1));
  btnMinus5.addEventListener('click', () => changeTempo(-5));
  btnPlus5.addEventListener('click', () => changeTempo(5));

  // Slider control
  tempoSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    sync.sendTempo(val);
    updateUI();
  });

  // Tap Tempo Feature
  btnTapTempo.addEventListener('click', () => {
    const now = performance.now();
    tapTimes.push(now);
    tapTimes = tapTimes.filter((t) => now - t < 3000);

    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) {
        intervals.push(tapTimes[i] - tapTimes[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      let calculatedBpm = Math.round(60000 / avgInterval);
      calculatedBpm = Math.min(280, Math.max(30, calculatedBpm));

      sync.sendTempo(calculatedBpm);
      updateUI();
    }
  });

  // Master Play / Stop button
  btnPlay.addEventListener('click', () => {
    audio.init();
    if (sync.isPlaying) {
      sync.sendStop();
    } else {
      sync.sendStart(sync.bpm, sync.beatsPerMeasure);
    }
  });

  // Time Signature buttons
  beatsSelectButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      beatsSelectButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const beats = parseInt(btn.dataset.beats, 10);
      sync.sendBeatsPerMeasure(beats);
      renderBeatDots();
    });
  });

  // Sound Type picker
  soundSelect.addEventListener('change', (e) => {
    sync.sendSoundType(e.target.value);
  });

  // Dual Network Mode Switcher
  networkModeSelect.addEventListener('change', (e) => {
    sync.init(sync.roomId, e.target.value);
  });

  // Hardware Delay Calibration Slider
  delaySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    delayValLabel.textContent = `${val > 0 ? '+' : ''}${val} ms`;
    sync.setHardwareDelay(val);
  });

  // Screen Wake Lock API
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  }

  wakeLockToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      requestWakeLock();
    } else if (wakeLockSentinel) {
      wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockToggle.checked) {
      requestWakeLock();
    }
  });

  // Audio Unlock for iOS Safari & Android
  function checkAudioUnlocked() {
    if (audio.audioCtx && audio.audioCtx.state === 'suspended') {
      audioUnlockBanner.classList.add('show');
    } else {
      audioUnlockBanner.classList.remove('show');
    }
  }

  audioUnlockBanner.addEventListener('click', () => {
    audio.init();
    checkAudioUnlocked();
  });

  document.body.addEventListener('touchstart', () => {
    audio.init();
    checkAudioUnlocked();
  }, { once: true });

  document.body.addEventListener('click', () => {
    audio.init();
    checkAudioUnlocked();
  }, { once: true });

  // Room Customization
  roomBadge.addEventListener('click', () => {
    const current = sync.roomId;
    const nextRoom = prompt('Enter Room Code for Band / Group Sync:', current);
    if (nextRoom && nextRoom.trim() !== '') {
      const roomClean = nextRoom.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'MAIN';
      roomBadge.textContent = `Room: ${roomClean} ✎`;
      sync.init(roomClean, sync.mode);
    }
  });

  // Render client-side QR Code
  function renderQrCode(targetUrl) {
    qrcodeContainer.innerHTML = '';
    wifiUrlInput.value = targetUrl;
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrcodeContainer, {
        text: targetUrl,
        width: 190,
        height: 190,
        colorDark: '#0a0e1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }

  // Wi-Fi / Room QR Code Modal
  btnQrModal.addEventListener('click', () => {
    const currentRoom = sync.roomId;
    const mode = sync.mode;
    const shareUrl = `${getAppBaseUrl()}?room=${encodeURIComponent(currentRoom)}&mode=${mode}`;
    renderQrCode(shareUrl);
    qrModal.classList.add('open');
  });

  btnCloseQr.addEventListener('click', () => {
    qrModal.classList.remove('open');
  });

  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.remove('open');
  });

  btnCopyUrl.addEventListener('click', () => {
    wifiUrlInput.select();
    navigator.clipboard.writeText(wifiUrlInput.value).then(() => {
      btnCopyUrl.textContent = 'Copied!';
      setTimeout(() => (btnCopyUrl.textContent = 'Copy'), 1500);
    });
  });

  // Start Sync Engine
  sync.init(initialRoom, initialMode);
  updateUI();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
});
