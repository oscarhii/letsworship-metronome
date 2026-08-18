/**
 * High-Precision Multi-Mode Synchronization Engine
 * Supports:
 * 1. WebRTC Peer-to-Peer (Serverless / Standalone PWA - zero server required)
 * 2. Local WebSocket Hub (Direct Wi-Fi server)
 */
class MetronomeSyncEngine {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.mode = 'webrtc'; // 'webrtc' or 'websocket'
    this.roomId = 'MAIN';
    this.deviceId = 'DEV_' + Math.random().toString(36).substring(2, 7).toUpperCase();
    this.isHost = false;
    this.isConnected = false;
    this.deviceCount = 1;

    // Time synchronization
    this.clockOffset = 0; // HostTime = Date.now() + clockOffset
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

    // WebRTC PeerJS state
    this.peer = null;
    this.hostConn = null; // Client -> Host connection
    this.clientConns = new Map(); // Host -> Map of Client connections

    // WebSocket state
    this.ws = null;

    this.lastVisualBeat = -1;
    this.animationFrameId = null;
  }

  getMasterNow() {
    return Date.now() + this.clockOffset;
  }

  setMode(mode) {
    this.mode = mode;
  }

  init(roomId = 'MAIN', mode = null) {
    if (mode) this.mode = mode;
    this.roomId = (roomId || 'MAIN').trim().toUpperCase();

    this.cleanup();

    if (this.mode === 'websocket') {
      this.initWebSocket();
    } else {
      this.initWebRTC();
    }
  }

  cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    if (this.periodicSyncInterval) {
      clearInterval(this.periodicSyncInterval);
      this.periodicSyncInterval = null;
    }
    this.hostConn = null;
    this.clientConns.clear();
    this.isConnected = false;
    this.isHost = false;
    this.deviceCount = 1;
  }

  // ==========================================
  // 1. WebRTC Peer-to-Peer Mode (Zero Server)
  // ==========================================
  initWebRTC() {
    const cleanRoom = (this.roomId || 'MAIN').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() || 'MAIN';
    const hostPeerId = `SYNCBEAT_${cleanRoom}_HOST`;
    const clientPeerId = `SYNCBEAT_${cleanRoom}_DEV_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const peerOptions = {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    };

    // First attempt to become the Host for this Room
    try {
      this.peer = new Peer(hostPeerId, peerOptions);

      this.peer.on('open', (id) => {
        // Successfully registered as Host!
        this.isHost = true;
        this.isConnected = true;
        this.clockOffset = 0;
        this.deviceCount = 1;
        if (this.onConnectionChange) {
          this.onConnectionChange(true, this.deviceCount, 0, true);
        }
      });

      this.peer.on('connection', (conn) => {
        // A peer connected to this Host
        this.setupHostClientConnection(conn);
      });

      this.peer.on('error', (err) => {
        // If Host ID is already registered by another phone, connect as Client!
        if (err.type === 'unavailable-id') {
          this.connectAsWebRTCClient(hostPeerId, clientPeerId, peerOptions);
        } else {
          console.warn('PeerJS status/warning:', err);
          // If already open, keep connected state
          if (this.peer && !this.peer.destroyed && this.peer.open) {
            this.isConnected = true;
          }
        }
      });
    } catch (e) {
      console.error('WebRTC initialization failed:', e);
    }
  }

  connectAsWebRTCClient(hostPeerId, clientPeerId, peerOptions) {
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    this.peer = new Peer(clientPeerId, peerOptions);

    this.peer.on('open', () => {
      this.hostConn = this.peer.connect(hostPeerId, { reliable: true });

      this.hostConn.on('open', () => {
        this.isHost = false;
        this.isConnected = true;

        // Run initial clock sync
        this.runWebRTCClockSync(() => {
          if (this.hostConn && this.hostConn.open) {
            this.hostConn.send({
              type: 'REQUEST_ROOM_STATE',
              payload: { deviceId: this.deviceId }
            });
          }
        });

        this.startPeriodicWebRTCSync();
        if (this.onConnectionChange) {
          this.onConnectionChange(true, 2, this.rtt, false);
        }
      });

      this.hostConn.on('data', (data) => {
        this.handlePeerMessage(data);
      });

      this.hostConn.on('close', () => {
        this.isConnected = false;
        if (this.onConnectionChange) {
          this.onConnectionChange(false, 1, 0, false);
        }
        // If host disconnected, try taking over as host after 1.5s
        setTimeout(() => this.init(this.roomId, 'webrtc'), 1500);
      });
    });

    this.peer.on('error', (err) => {
      console.warn('WebRTC client error:', err);
    });
  }

  setupHostClientConnection(conn) {
    this.clientConns.set(conn.peer, conn);
    this.deviceCount = this.clientConns.size + 1;

    conn.on('data', (data) => {
      const { type, payload } = data;

      switch (type) {
        case 'PING': {
          conn.send({
            type: 'PONG',
            payload: {
              clientSendTime: payload.clientSendTime,
              serverReceiveTime: Date.now()
            }
          });
          break;
        }

        case 'REQUEST_ROOM_STATE': {
          conn.send({
            type: 'ROOM_JOINED',
            payload: {
              roomId: this.roomId,
              deviceId: this.deviceId,
              state: {
                isPlaying: this.isPlaying,
                bpm: this.bpm,
                beatsPerMeasure: this.beatsPerMeasure,
                startMasterTime: this.startMasterTime,
                soundType: this.audio.soundType
              },
              deviceCount: this.deviceCount
            }
          });
          this.broadcastPeerStats();
          break;
        }

        case 'FORWARD_ACTION': {
          // Client asked to execute action -> host handles & broadcasts
          this.handleActionFromClient(payload);
          break;
        }
      }
    });

    conn.on('close', () => {
      this.clientConns.delete(conn.peer);
      this.deviceCount = this.clientConns.size + 1;
      this.broadcastPeerStats();
    });

    if (this.onConnectionChange) {
      this.onConnectionChange(true, this.deviceCount, 0, true);
    }
  }

  broadcastToPeers(msg) {
    for (const conn of this.clientConns.values()) {
      if (conn.open) {
        conn.send(msg);
      }
    }
  }

  broadcastPeerStats() {
    this.broadcastToPeers({
      type: 'ROOM_STATS',
      payload: { deviceCount: this.deviceCount }
    });
    if (this.onConnectionChange) {
      this.onConnectionChange(true, this.deviceCount, this.rtt, this.isHost);
    }
  }

  runWebRTCClockSync(callback) {
    let pingCount = 0;
    const totalPings = 6;
    this.syncSamples = [];

    const sendPing = () => {
      if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'PING',
          payload: { clientSendTime: performance.now() }
        });
      }
    };

    this.pendingWebRTCPing = (rtt, offset) => {
      this.syncSamples.push({ rtt, offset });
      pingCount++;
      if (pingCount < totalPings) {
        setTimeout(sendPing, 40);
      } else {
        this.syncSamples.sort((a, b) => a.rtt - b.rtt);
        const best = this.syncSamples[0];
        this.clockOffset = best.offset;
        this.rtt = Math.round(best.rtt);
        this.isSynced = true;
        this.pendingWebRTCPing = null;
        if (callback) callback();
      }
    };

    sendPing();
  }

  startPeriodicWebRTCSync() {
    if (this.periodicSyncInterval) clearInterval(this.periodicSyncInterval);
    this.periodicSyncInterval = setInterval(() => {
      if (this.hostConn && this.hostConn.open && !this.isHost) {
        const clientSendTime = performance.now();
        this.oneOffPing = (rtt, offset) => {
          this.clockOffset = this.clockOffset * 0.8 + offset * 0.2;
          this.rtt = Math.round(rtt);
          if (this.onConnectionChange) {
            this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.isHost);
          }
          this.oneOffPing = null;
        };
        this.hostConn.send({
          type: 'PING',
          payload: { clientSendTime }
        });
      }
    }, 5000);
  }

  handlePeerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'PONG': {
        const clientReceiveTime = performance.now();
        const rtt = clientReceiveTime - payload.clientSendTime;
        const approxLocalEpoch = Date.now() - rtt / 2;
        const offset = payload.serverReceiveTime - approxLocalEpoch;

        if (this.pendingWebRTCPing) {
          this.pendingWebRTCPing(rtt, offset);
        } else if (this.oneOffPing) {
          this.oneOffPing(rtt, offset);
        }
        break;
      }

      case 'ROOM_JOINED': {
        this.deviceCount = payload.deviceCount;
        this.bpm = payload.state.bpm || 120;
        this.beatsPerMeasure = payload.state.beatsPerMeasure || 4;
        if (payload.state.soundType) {
          this.audio.setSoundType(payload.state.soundType);
        }
        if (payload.state.isPlaying && payload.state.startMasterTime) {
          this.startPlayback(payload.state.startMasterTime, this.bpm, this.beatsPerMeasure);
        }
        if (this.onStateChange) this.onStateChange();
        if (this.onConnectionChange) this.onConnectionChange(true, this.deviceCount, this.rtt, this.isHost);
        break;
      }

      case 'ROOM_STATS': {
        this.deviceCount = payload.deviceCount;
        if (this.onConnectionChange) this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.isHost);
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

  handleActionFromClient(action) {
    const { actionType, data } = action;
    switch (actionType) {
      case 'START':
        this.sendStart(data.bpm, data.beatsPerMeasure);
        break;
      case 'STOP':
        this.sendStop();
        break;
      case 'TEMPO':
        this.sendTempo(data.bpm);
        break;
      case 'BEATS':
        this.sendBeatsPerMeasure(data.beatsPerMeasure);
        break;
      case 'SOUND':
        this.sendSoundType(data.soundType);
        break;
    }
  }

  // ==========================================
  // 2. Local WebSocket Mode (When Local Server Active)
  // ==========================================
  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.runWebSocketClockSync(() => {
          this.ws.send(JSON.stringify({
            type: 'JOIN_ROOM',
            payload: { roomId: this.roomId }
          }));
        });
        this.startPeriodicWebSocketSync();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handlePeerMessage(msg);
        } catch (e) {}
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.onConnectionChange) this.onConnectionChange(false, 1, 0, false);
      };
    } catch (e) {
      console.warn('WebSocket init failed:', e);
    }
  }

  runWebSocketClockSync(callback) {
    let pingCount = 0;
    const totalPings = 8;
    this.syncSamples = [];

    const sendPing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'PING',
          payload: { clientSendTime: performance.now() }
        }));
      }
    };

    this.pendingWebRTCPing = (rtt, offset) => {
      this.syncSamples.push({ rtt, offset });
      pingCount++;
      if (pingCount < totalPings) {
        setTimeout(sendPing, 50);
      } else {
        this.syncSamples.sort((a, b) => a.rtt - b.rtt);
        const best = this.syncSamples[0];
        this.clockOffset = best.offset;
        this.rtt = Math.round(best.rtt);
        this.isSynced = true;
        this.pendingWebRTCPing = null;
        if (callback) callback();
      }
    };

    sendPing();
  }

  startPeriodicWebSocketSync() {
    if (this.periodicSyncInterval) clearInterval(this.periodicSyncInterval);
    this.periodicSyncInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const clientSendTime = performance.now();
        this.oneOffPing = (rtt, offset) => {
          this.clockOffset = this.clockOffset * 0.8 + offset * 0.2;
          this.rtt = Math.round(rtt);
          if (this.onConnectionChange) {
            this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.isHost);
          }
          this.oneOffPing = null;
        };
        this.ws.send(JSON.stringify({
          type: 'PING',
          payload: { clientSendTime }
        }));
      }
    }, 6000);
  }

  // ==========================================
  // Unified Action Dispatachers
  // ==========================================
  sendStart(bpm, beatsPerMeasure) {
    this.audio.init();
    const startMasterTime = this.getMasterNow() + 400;
    this.bpm = bpm || this.bpm;
    this.beatsPerMeasure = beatsPerMeasure || this.beatsPerMeasure;

    if (this.mode === 'webrtc') {
      if (this.isHost) {
        this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
        this.broadcastToPeers({
          type: 'METRONOME_STARTED',
          payload: {
            startMasterTime,
            bpm: this.bpm,
            beatsPerMeasure: this.beatsPerMeasure
          }
        });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'FORWARD_ACTION',
          payload: { actionType: 'START', data: { bpm: this.bpm, beatsPerMeasure: this.beatsPerMeasure } }
        });
      } else {
        this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
      }
    } else if (this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'START_METRONOME',
        payload: { bpm: this.bpm, beatsPerMeasure: this.beatsPerMeasure, leadTime: 400 }
      }));
    } else {
      this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendStop() {
    if (this.mode === 'webrtc') {
      if (this.isHost) {
        this.stopPlayback();
        this.broadcastToPeers({ type: 'METRONOME_STOPPED', payload: {} });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'FORWARD_ACTION',
          payload: { actionType: 'STOP', data: {} }
        });
      } else {
        this.stopPlayback();
      }
    } else if (this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'STOP_METRONOME', payload: {} }));
    } else {
      this.stopPlayback();
    }
    if (this.onStateChange) this.onStateChange();
  }

  sendTempo(newBpm) {
    this.bpm = newBpm;
    if (this.mode === 'webrtc') {
      if (this.isHost) {
        const startMasterTime = this.isPlaying ? this.getMasterNow() + 300 : null;
        if (this.isPlaying) {
          this.startPlayback(startMasterTime, this.bpm, this.beatsPerMeasure);
        }
        this.broadcastToPeers({
          type: 'TEMPO_UPDATED',
          payload: { bpm: this.bpm, startMasterTime }
        });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'FORWARD_ACTION',
          payload: { actionType: 'TEMPO', data: { bpm: newBpm } }
        });
      }
    } else if (this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'SET_TEMPO', payload: { bpm: newBpm } }));
    } else if (this.isPlaying) {
      this.startPlayback(this.getMasterNow() + 100, this.bpm, this.beatsPerMeasure);
    }
  }

  sendBeatsPerMeasure(beats) {
    this.beatsPerMeasure = beats;
    if (this.mode === 'webrtc') {
      if (this.isHost) {
        this.broadcastToPeers({ type: 'BEATS_UPDATED', payload: { beatsPerMeasure: beats } });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'FORWARD_ACTION',
          payload: { actionType: 'BEATS', data: { beatsPerMeasure: beats } }
        });
      }
    } else if (this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'SET_BEATS', payload: { beatsPerMeasure: beats } }));
    }
  }

  sendSoundType(soundType) {
    this.audio.setSoundType(soundType);
    if (this.mode === 'webrtc') {
      if (this.isHost) {
        this.broadcastToPeers({ type: 'SOUND_UPDATED', payload: { soundType } });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'FORWARD_ACTION',
          payload: { actionType: 'SOUND', data: { soundType } }
        });
      }
    } else if (this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'SET_SOUND', payload: { soundType } }));
    }
  }

  // ==========================================
  // Core Lookahead Scheduler
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
