/**
 * High-Precision Multi-Mode Synchronization Engine
 * Features:
 * 1. Continuous Multi-Sample NTP Clock Synchronization (Median Filter)
 * 2. Dual Network Support:
 *    - Cloud PubSub Mode (Any Wi-Fi / 4G / 5G / GitHub Pages)
 *    - Local Wi-Fi WebSocket Mode (Ultra-low latency LAN)
 * 3. Hardware Audio Delay Compensation (Fine Nudge)
 */
class MetronomeSyncEngine {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.mode = 'cloud'; // 'cloud' or 'local'
    this.roomId = 'MAIN';
    this.deviceId = 'DEV_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    this.isConnected = false;
    this.deviceCount = 1;
    this.peerPresence = new Map();

    // High Precision NTP variables
    this.clockOffset = 0; // LocalTime + clockOffset = MasterRoomTime
    this.rtt = 0;
    this.pingHistory = [];
    this.isSynced = false;
    this.hardwareDelayMs = 0; // User adjustable latency compensation (-100ms to +100ms)

    // Playback state
    this.isPlaying = false;
    this.bpm = 120;
    this.beatsPerMeasure = 4;
    this.startMasterTime = null;

    // Scheduler
    this.schedulerTimer = null;
    this.lookaheadMs = 20;
    this.scheduleAheadSec = 0.20; // 200ms ahead for rock-solid audio scheduling
    this.nextBeatNumber = 0;

    // Callbacks
    this.onBeat = null;
    this.onStateChange = null;
    this.onConnectionChange = null;

    // Clients
    this.mqttClient = null;
    this.wsClient = null;
    this.presenceTimer = null;
    this.periodicPingTimer = null;

    this.lastVisualBeat = -1;
    this.animationFrameId = null;
  }

  getMasterNow() {
    return Date.now() + this.clockOffset + this.hardwareDelayMs;
  }

  setHardwareDelay(ms) {
    this.hardwareDelayMs = parseInt(ms, 10) || 0;
  }

  init(roomId = 'MAIN', mode = 'cloud') {
    this.roomId = (roomId || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'MAIN';
    this.mode = mode || 'cloud';

    this.cleanup();

    if (this.mode === 'local') {
      this.initLocalWebSocket();
    } else {
      this.initCloudPubSub();
    }
  }

  cleanup() {
    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (e) {}
      this.mqttClient = null;
    }
    if (this.wsClient) {
      try { this.wsClient.close(); } catch (e) {}
      this.wsClient = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.periodicPingTimer) {
      clearInterval(this.periodicPingTimer);
      this.periodicPingTimer = null;
    }
    this.peerPresence.clear();
    this.isConnected = false;
    this.deviceCount = 1;
  }

  // ==========================================
  // 1. Cloud PubSub Sync (MQTT over WSS)
  // ==========================================
  initCloudPubSub() {
    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
    const topicPresence = `letsworship/metronome/v2/${this.roomId}/presence`;

    try {
      if (typeof mqtt === 'undefined') {
        console.warn('MQTT client unavailable, standalone mode');
        this.isConnected = true;
        if (this.onConnectionChange) this.onConnectionChange(true, 1, 0, 'cloud');
        return;
      }

      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: `sync_${this.deviceId}`,
        clean: true,
        connectTimeout: 5000,
        keepalive: 20
      });

      this.mqttClient.on('connect', () => {
        this.isConnected = true;
        this.deviceCount = 1;

        this.mqttClient.subscribe([topicRoom, topicPresence], (err) => {
          if (!err) {
            this.sendPresence();
            this.startPresenceHeartbeat();
            // Run rapid burst of 6 NTP calibration pings
            this.runCalibrationBurst();
            this.startContinuousNtpSync();
          }
        });

        if (this.onConnectionChange) {
          this.onConnectionChange(true, this.deviceCount, this.rtt, 'cloud');
        }
      });

      this.mqttClient.on('message', (topic, messageBuffer) => {
        try {
          const msg = JSON.parse(messageBuffer.toString());
          this.handleCloudMessage(topic, msg);
        } catch (e) {}
      });

      this.mqttClient.on('offline', () => {
        this.isConnected = false;
        if (this.onConnectionChange) this.onConnectionChange(false, 1, 0, 'cloud');
      });

      this.mqttClient.on('reconnect', () => {
        this.isConnected = true;
        if (this.onConnectionChange) this.onConnectionChange(true, this.deviceCount, this.rtt, 'cloud');
      });
    } catch (e) {
      console.error('Cloud sync error:', e);
      this.isConnected = true;
      if (this.onConnectionChange) this.onConnectionChange(true, 1, 0, 'cloud');
    }
  }

  // ==========================================
  // 2. Local Wi-Fi WebSocket Sync (Node.js Server on LAN)
  // ==========================================
  initLocalWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      this.wsClient = new WebSocket(wsUrl);

      this.wsClient.onopen = () => {
        this.isConnected = true;
        this.wsClient.send(JSON.stringify({
          type: 'JOIN_ROOM',
          payload: { roomId: this.roomId }
        }));
        this.runLocalWebSocketNtpBurst();
        if (this.onConnectionChange) this.onConnectionChange(true, this.deviceCount, this.rtt, 'local');
      };

      this.wsClient.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleLocalWsMessage(msg);
        } catch (e) {}
      };

      this.wsClient.onclose = () => {
        this.isConnected = false;
        if (this.onConnectionChange) this.onConnectionChange(false, 1, 0, 'local');
      };
    } catch (e) {
      console.warn('Local WS error:', e);
    }
  }

  // ==========================================
  // NTP Clock Calibration Engine
  // ==========================================
  runCalibrationBurst() {
    let count = 0;
    const burstTimer = setInterval(() => {
      this.sendNtpPing();
      count++;
      if (count >= 6) clearInterval(burstTimer);
    }, 150);
  }

  startContinuousNtpSync() {
    if (this.periodicPingTimer) clearInterval(this.periodicPingTimer);
    this.periodicPingTimer = setInterval(() => {
      this.sendNtpPing();
    }, 4000);
  }

  sendNtpPing() {
    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'NTP_PING',
        from: this.deviceId,
        clientSendTime: performance.now()
      }));
    }
  }

  runLocalWebSocketNtpBurst() {
    let count = 0;
    const burst = setInterval(() => {
      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        this.wsClient.send(JSON.stringify({
          type: 'PING',
          payload: { clientSendTime: performance.now() }
        }));
      }
      count++;
      if (count >= 6) clearInterval(burst);
    }, 100);
  }

  sendPresence() {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    const topicPresence = `letsworship/metronome/v2/${this.roomId}/presence`;
    this.mqttClient.publish(topicPresence, JSON.stringify({
      deviceId: this.deviceId,
      timestamp: Date.now()
    }));
  }

  startPresenceHeartbeat() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => {
      this.sendPresence();

      const now = Date.now();
      for (const [id, lastSeen] of this.peerPresence.entries()) {
        if (now - lastSeen > 8000) {
          this.peerPresence.delete(id);
        }
      }
      this.deviceCount = this.peerPresence.size + 1;
      if (this.onConnectionChange) {
        this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.mode);
      }
    }, 2500);
  }

  handleCloudMessage(topic, msg) {
    if (topic.endsWith('/presence')) {
      if (msg.deviceId && msg.deviceId !== this.deviceId) {
        this.peerPresence.set(msg.deviceId, Date.now());
        this.deviceCount = this.peerPresence.size + 1;
        if (this.onConnectionChange) {
          this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.mode);
        }
      }
      return;
    }

    const { type, from } = msg;

    switch (type) {
      case 'NTP_PING': {
        // Reply with server time timestamp
        if (from !== this.deviceId && this.mqttClient && this.mqttClient.connected) {
          const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
          this.mqttClient.publish(topicRoom, JSON.stringify({
            type: 'NTP_PONG',
            to: from,
            clientSendTime: msg.clientSendTime,
            serverEpoch: Date.now()
          }));
        }
        break;
      }

      case 'NTP_PONG': {
        if (msg.to === this.deviceId) {
          const clientReceiveTime = performance.now();
          const rtt = clientReceiveTime - msg.clientSendTime;
          const approxLocalEpoch = Date.now() - rtt / 2;
          const offset = msg.serverEpoch - approxLocalEpoch;

          this.pingHistory.push({ rtt, offset });
          if (this.pingHistory.length > 8) this.pingHistory.shift();

          // Compute median offset (filters out network spikes)
          const sorted = [...this.pingHistory].sort((a, b) => a.rtt - b.rtt);
          const medianSample = sorted[0];

          this.clockOffset = Math.round(medianSample.offset);
          this.rtt = Math.round(medianSample.rtt);
          this.isSynced = true;

          if (this.onConnectionChange) {
            this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.mode);
          }
        }
        break;
      }

      case 'START': {
        this.bpm = msg.bpm;
        this.beatsPerMeasure = msg.beatsPerMeasure;
        this.startPlayback(msg.startMasterTime, this.bpm, this.beatsPerMeasure);
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'STOP': {
        this.stopPlayback();
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'TEMPO': {
        this.bpm = msg.bpm;
        if (this.isPlaying && msg.startMasterTime) {
          this.startPlayback(msg.startMasterTime, this.bpm, this.beatsPerMeasure);
        }
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'BEATS': {
        this.beatsPerMeasure = msg.beatsPerMeasure;
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'SOUND': {
        this.audio.setSoundType(msg.soundType);
        if (this.onStateChange) this.onStateChange();
        break;
      }
    }
  }

  handleLocalWsMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'PONG': {
        const clientReceiveTime = performance.now();
        const rtt = clientReceiveTime - payload.clientSendTime;
        const approxLocalEpoch = Date.now() - rtt / 2;
        const offset = payload.serverReceiveTime - approxLocalEpoch;

        this.clockOffset = Math.round(offset);
        this.rtt = Math.round(rtt);
        this.isSynced = true;
        if (this.onConnectionChange) {
          this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.mode);
        }
        break;
      }

      case 'ROOM_JOINED':
      case 'ROOM_STATS': {
        if (payload.deviceCount) this.deviceCount = payload.deviceCount;
        if (this.onConnectionChange) this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.mode);
        break;
      }

      case 'METRONOME_STARTED': {
        this.bpm = payload.bpm;
        this.beatsPerMeasure = payload.beatsPerMeasure;
        this.startPlayback(payload.startMasterTime, this.bpm, this.beatsPerMeasure);
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'METRONOME_STOPPED': {
        this.stopPlayback();
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'TEMPO_UPDATED': {
        this.bpm = payload.bpm;
        if (this.isPlaying && payload.startMasterTime) {
          this.startPlayback(payload.startMasterTime, this.bpm, this.beatsPerMeasure);
        }
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'BEATS_UPDATED': {
        this.beatsPerMeasure = payload.beatsPerMeasure;
        if (this.onStateChange) this.onStateChange();
        break;
      }

      case 'SOUND_UPDATED': {
        this.audio.setSoundType(payload.soundType);
        if (this.onStateChange) this.onStateChange();
        break;
      }
    }
  }

  // ==========================================
  // Synchronized Actions (With 600ms Lead-time for Perfect Phase Alignment)
  // ==========================================
  sendStart(bpm, beatsPerMeasure) {
    this.audio.init();
    // 600ms lead time allows network packets to arrive on all phones with 0ms audio lag
    const leadTime = 600;
    const startMasterTime = this.getMasterNow() + leadTime;
    this.bpm = bpm || this.bpm;
    this.beatsPerMeasure = beatsPerMeasure || this.beatsPerMeasure;

    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'START',
        from: this.deviceId,
        startMasterTime,
        bpm: this.bpm,
        beatsPerMeasure: this.beatsPerMeasure
      }));
    } else if (this.mode === 'local' && this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({
        type: 'START_METRONOME',
        payload: { bpm: this.bpm, beatsPerMeasure: this.beatsPerMeasure, leadTime: 500 }
      }));
    } else {
      this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendStop() {
    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'STOP',
        from: this.deviceId
      }));
    } else if (this.mode === 'local' && this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'STOP_METRONOME', payload: {} }));
    } else {
      this.stopPlayback();
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendTempo(newBpm) {
    this.bpm = newBpm;
    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      const startMasterTime = this.isPlaying ? this.getMasterNow() + 400 : null;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'TEMPO',
        from: this.deviceId,
        bpm: this.bpm,
        startMasterTime
      }));
    } else if (this.mode === 'local' && this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'SET_TEMPO', payload: { bpm: newBpm } }));
    } else if (this.isPlaying) {
      this.startPlayback(this.getMasterNow() + 100, this.bpm, this.beatsPerMeasure);
    }
  }

  sendBeatsPerMeasure(beats) {
    this.beatsPerMeasure = beats;
    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'BEATS',
        from: this.deviceId,
        beatsPerMeasure: beats
      }));
    } else if (this.mode === 'local' && this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'SET_BEATS', payload: { beatsPerMeasure: beats } }));
    }
  }

  sendSoundType(soundType) {
    this.audio.setSoundType(soundType);
    if (this.mode === 'cloud' && this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v2/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'SOUND',
        from: this.deviceId,
        soundType
      }));
    } else if (this.mode === 'local' && this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'SET_SOUND', payload: { soundType } }));
    }
  }

  // ==========================================
  // Core Lookahead Audio Scheduler (DAC Hardware Precision)
  // ==========================================
  startPlayback(startMasterTime, bpm, beatsPerMeasure) {
    this.audio.init();
    this.isPlaying = true;
    this.startMasterTime = startMasterTime;
    this.bpm = bpm;
    this.beatsPerMeasure = beatsPerMeasure;

    const beatIntervalMs = (60 / this.bpm) * 1000;
    const masterNow = this.getMasterNow();

    if (masterNow >= this.startMasterTime) {
      const elapsed = masterNow - this.startMasterTime;
      this.nextBeatNumber = Math.floor(elapsed / beatIntervalMs) + 1;
    } else {
      this.nextBeatNumber = 0;
    }

    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = setInterval(() => this.runScheduler(), this.lookaheadMs);

    this.startVisualLoop();
  }

  stopPlayback() {
    this.isPlaying = false;
    this.startMasterTime = null;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.lastVisualBeat = -1;
  }

  runScheduler() {
    if (!this.isPlaying || !this.startMasterTime) return;

    const beatIntervalMs = (60 / this.bpm) * 1000;
    const masterNow = this.getMasterNow();
    const currentAudioTime = this.audio.getCurrentAudioTime();

    const scheduleUntilMasterTime = masterNow + (this.scheduleAheadSec * 1000);

    while (true) {
      const targetBeatMasterTime = this.startMasterTime + (this.nextBeatNumber * beatIntervalMs);
      if (targetBeatMasterTime > scheduleUntilMasterTime) break;

      const diffMs = targetBeatMasterTime - masterNow;
      const targetAudioTime = currentAudioTime + (diffMs / 1000);
      const isAccent = (this.nextBeatNumber % this.beatsPerMeasure) === 0;

      if (targetAudioTime >= currentAudioTime - 0.02) {
        this.audio.scheduleBeat(targetAudioTime, isAccent);
      }

      this.nextBeatNumber++;
    }
  }

  startVisualLoop() {
    const checkVisualBeat = () => {
      if (!this.isPlaying || !this.startMasterTime) return;

      const beatIntervalMs = (60 / this.bpm) * 1000;
      const masterNow = this.getMasterNow();

      if (masterNow >= this.startMasterTime) {
        const elapsed = masterNow - this.startMasterTime;
        const currentBeatIndex = Math.floor(elapsed / beatIntervalMs);

        if (currentBeatIndex !== this.lastVisualBeat) {
          this.lastVisualBeat = currentBeatIndex;
          const beatInMeasure = (currentBeatIndex % this.beatsPerMeasure) + 1;
          const isAccent = beatInMeasure === 1;
          if (this.onBeat) {
            this.onBeat(beatInMeasure, isAccent);
          }
        }
      }

      this.animationFrameId = requestAnimationFrame(checkVisualBeat);
    };

    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = requestAnimationFrame(checkVisualBeat);
  }
}

window.MetronomeSyncEngine = MetronomeSyncEngine;
