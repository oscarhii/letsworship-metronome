/**
 * High-Precision Universal Synchronization Engine
 * Uses Ultra-Fast WSS PubSub / MQTT for seamless cross-network & cross-device beat sync.
 */
class MetronomeSyncEngine {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.roomId = 'MAIN';
    this.deviceId = 'DEV_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    this.isConnected = false;
    this.deviceCount = 1;
    this.peerPresence = new Map();

    // Time synchronization
    this.clockOffset = 0;
    this.rtt = 0;
    this.syncSamples = [];
    this.isSynced = false;

    // Playback state
    this.isPlaying = false;
    this.bpm = 120;
    this.beatsPerMeasure = 4;
    this.startMasterTime = null;

    // Scheduler
    this.schedulerTimer = null;
    this.lookaheadMs = 25;
    this.scheduleAheadSec = 0.15;
    this.nextBeatNumber = 0;

    // Callbacks
    this.onBeat = null;
    this.onStateChange = null;
    this.onConnectionChange = null;

    // Client instance
    this.mqttClient = null;
    this.presenceTimer = null;

    this.lastVisualBeat = -1;
    this.animationFrameId = null;
  }

  getMasterNow() {
    return Date.now() + this.clockOffset;
  }

  init(roomId = 'MAIN') {
    this.roomId = (roomId || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!this.roomId) this.roomId = 'MAIN';

    this.cleanup();
    this.initCloudPubSub();
  }

  cleanup() {
    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch (e) {}
      this.mqttClient = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.periodicSyncInterval) {
      clearInterval(this.periodicSyncInterval);
      this.periodicSyncInterval = null;
    }
    this.peerPresence.clear();
    this.isConnected = false;
    this.deviceCount = 1;
  }

  // ==========================================
  // Cloud WSS PubSub Synchronization
  // ==========================================
  initCloudPubSub() {
    // Primary public brokers with fallback
    const brokerUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    const brokerUrl = brokerUrls[0];

    const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
    const topicPresence = `letsworship/metronome/v1/${this.roomId}/presence`;

    try {
      if (typeof mqtt === 'undefined') {
        console.warn('MQTT library not loaded, running in standalone mode.');
        this.isConnected = true;
        if (this.onConnectionChange) this.onConnectionChange(true, 1, 0);
        return;
      }

      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: `sync_${this.deviceId}`,
        clean: true,
        connectTimeout: 4000,
        keepalive: 30
      });

      this.mqttClient.on('connect', () => {
        this.isConnected = true;
        this.deviceCount = 1;

        this.mqttClient.subscribe([topicRoom, topicPresence], (err) => {
          if (!err) {
            // Announce presence
            this.sendPresence();
            // Start periodic presence heartbeat
            this.startPresenceHeartbeat();
            // Run initial clock sync ping
            this.sendPing();
          }
        });

        if (this.onConnectionChange) {
          this.onConnectionChange(true, this.deviceCount, this.rtt);
        }
      });

      this.mqttClient.on('message', (topic, messageBuffer) => {
        try {
          const msg = JSON.parse(messageBuffer.toString());
          this.handleNetworkMessage(topic, msg);
        } catch (e) {
          console.warn('Error parsing message:', e);
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('MQTT connection warning:', err);
      });

      this.mqttClient.on('offline', () => {
        this.isConnected = false;
        if (this.onConnectionChange) {
          this.onConnectionChange(false, 1, 0);
        }
      });

      this.mqttClient.on('reconnect', () => {
        this.isConnected = true;
        if (this.onConnectionChange) {
          this.onConnectionChange(true, this.deviceCount, this.rtt);
        }
      });
    } catch (e) {
      console.error('Failed to initialize sync:', e);
      this.isConnected = true;
      if (this.onConnectionChange) this.onConnectionChange(true, 1, 0);
    }
  }

  sendPresence() {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    const topicPresence = `letsworship/metronome/v1/${this.roomId}/presence`;
    this.mqttClient.publish(topicPresence, JSON.stringify({
      deviceId: this.deviceId,
      timestamp: Date.now(),
      bpm: this.bpm,
      isPlaying: this.isPlaying
    }));
  }

  startPresenceHeartbeat() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => {
      this.sendPresence();

      // Clean up stale peers (inactive for > 8s)
      const now = Date.now();
      for (const [id, lastSeen] of this.peerPresence.entries()) {
        if (now - lastSeen > 8000) {
          this.peerPresence.delete(id);
        }
      }
      this.deviceCount = this.peerPresence.size + 1;
      if (this.onConnectionChange) {
        this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt);
      }
    }, 3000);
  }

  sendPing() {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
    this.mqttClient.publish(topicRoom, JSON.stringify({
      type: 'PING',
      from: this.deviceId,
      clientSendTime: performance.now()
    }));
  }

  handleNetworkMessage(topic, msg) {
    // 1. Handle presence updates
    if (topic.endsWith('/presence')) {
      if (msg.deviceId && msg.deviceId !== this.deviceId) {
        this.peerPresence.set(msg.deviceId, Date.now());
        this.deviceCount = this.peerPresence.size + 1;
        if (this.onConnectionChange) {
          this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt);
        }
      }
      return;
    }

    // 2. Handle room sync events
    const { type, from } = msg;

    switch (type) {
      case 'PING': {
        // If another device pinged, reply with PONG + our clock timestamp
        if (from !== this.deviceId && this.mqttClient && this.mqttClient.connected) {
          const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
          this.mqttClient.publish(topicRoom, JSON.stringify({
            type: 'PONG',
            to: from,
            clientSendTime: msg.clientSendTime,
            serverReceiveTime: Date.now()
          }));
        }
        break;
      }

      case 'PONG': {
        // If PONG is addressed to us, compute NTP clock offset and RTT
        if (msg.to === this.deviceId) {
          const clientReceiveTime = performance.now();
          const rtt = clientReceiveTime - msg.clientSendTime;
          const approxLocalEpoch = Date.now() - rtt / 2;
          const offset = msg.serverReceiveTime - approxLocalEpoch;

          // Smooth offset update
          if (!this.isSynced) {
            this.clockOffset = offset;
            this.isSynced = true;
          } else {
            this.clockOffset = this.clockOffset * 0.8 + offset * 0.2;
          }
          this.rtt = Math.round(rtt);
          if (this.onConnectionChange) {
            this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt);
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

  // ==========================================
  // Public Action Broadcasters
  // ==========================================
  sendStart(bpm, beatsPerMeasure) {
    this.audio.init();
    const startMasterTime = this.getMasterNow() + 400;
    this.bpm = bpm || this.bpm;
    this.beatsPerMeasure = beatsPerMeasure || this.beatsPerMeasure;

    if (this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'START',
        from: this.deviceId,
        startMasterTime,
        bpm: this.bpm,
        beatsPerMeasure: this.beatsPerMeasure
      }));
    } else {
      this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendStop() {
    if (this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'STOP',
        from: this.deviceId
      }));
    } else {
      this.stopPlayback();
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendTempo(newBpm) {
    this.bpm = newBpm;
    if (this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
      const startMasterTime = this.isPlaying ? this.getMasterNow() + 300 : null;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'TEMPO',
        from: this.deviceId,
        bpm: this.bpm,
        startMasterTime
      }));
    } else if (this.isPlaying) {
      this.startPlayback(this.getMasterNow() + 100, this.bpm, this.beatsPerMeasure);
    }
  }

  sendBeatsPerMeasure(beats) {
    this.beatsPerMeasure = beats;
    if (this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'BEATS',
        from: this.deviceId,
        beatsPerMeasure: beats
      }));
    }
  }

  sendSoundType(soundType) {
    this.audio.setSoundType(soundType);
    if (this.mqttClient && this.mqttClient.connected) {
      const topicRoom = `letsworship/metronome/v1/${this.roomId}/events`;
      this.mqttClient.publish(topicRoom, JSON.stringify({
        type: 'SOUND',
        from: this.deviceId,
        soundType
      }));
    }
  }

  // ==========================================
  // Lookahead Web Audio API Scheduler
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
