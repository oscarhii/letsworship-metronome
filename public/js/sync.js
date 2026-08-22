/**
 * Offline WebRTC sync. Pairing data is exchanged by QR/copy-paste and
 * STUN only helps browsers discover a compatible peer-to-peer route. No TURN
 * relay is used, so beat traffic is never forwarded through a media server.
 */
class MetronomeSyncEngine {
  constructor(audio) {
    this.audio = audio;
    this.deviceId = localStorage.getItem('syncbeat-device-id') || ('DEV_' + Math.random().toString(36).slice(2, 8).toUpperCase());
    localStorage.setItem('syncbeat-device-id', this.deviceId);
    this.roomId = 'MAIN';
    this.role = 'standalone';
    this.hostPeers = new Map();
    this.pendingPeers = new Map();
    this.hostPeer = null;
    this.isConnected = true;
    this.deviceCount = 1;
    this.clockOffset = 0;
    this.rtt = 0;
    this.pings = [];
    this.pingTimer = null;
    this.hardwareDelayMs = 0;
    this.isPlaying = false;
    this.bpm = 120;
    this.beatsPerMeasure = 4;
    this.noteValue = 4;
    this.accentPattern = ['accent', 'normal', 'normal', 'normal'];
    this.startMasterTime = null;
    this.schedulerTimer = null;
    this.animationFrameId = null;
    this.nextBeatNumber = 0;
    this.lastVisualBeat = -1;
    this.onBeat = null;
    this.onStateChange = null;
    this.onConnectionChange = null;
    this.onAppEvent = null;
    this.appState = null;
    this.bandState = null;
    this.followingPaused = false;
    this.pausedHostState = null;
  }

  init(roomId) {
    this.roomId = (roomId || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'MAIN';
    this.notifyConnection();
  }

  getMasterNow() { return Date.now() + this.clockOffset + this.hardwareDelayMs; }
  setHardwareDelay(ms) { this.hardwareDelayMs = parseInt(ms, 10) || 0; }

  notifyConnection() {
    const guestOpen = this.hostPeer && this.hostPeer.channel.readyState === 'open';
    this.deviceCount = this.role === 'host' ? this.hostPeers.size + 1 : (guestOpen ? 2 : 1);
    this.isConnected = this.role !== 'guest' || Boolean(guestOpen);
    if (this.onConnectionChange) {
      this.onConnectionChange(this.isConnected, this.deviceCount, this.rtt, this.role);
    }
  }

  makePeer() {
    if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');
    return new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }
      ],
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle'
    });
  }

  static waitForIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }, 30000);
    });
  }

  static ensureCandidates(pc) {
    const sdp = pc.localDescription && pc.localDescription.sdp || '';
    if (!/a=candidate:/i.test(sdp)) {
      throw new Error('No network route was found. Keep Wi-Fi enabled and try creating a new invitation.');
    }
  }

  static encodeCode(data) {
    if (!window.pako) throw new Error('Pairing compressor is unavailable.');
    const bytes = window.pako.deflate(JSON.stringify(data), { level: 9 });
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
    }
    return 'SB1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  static decodeCode(raw) {
    const value = (raw || '').trim();
    if (!value.startsWith('SB1.')) return JSON.parse(value);
    if (!window.pako) throw new Error('Pairing decompressor is unavailable.');
    let base64 = value.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    base64 += '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(window.pako.inflate(bytes, { to: 'string' }));
  }

  static parseCode(raw, kind) {
    let data;
    try { data = MetronomeSyncEngine.decodeCode(raw); } catch (_) { throw new Error('Invalid pairing code.'); }
    if (data.app !== 'syncbeat' || data.version !== 1 || data.kind !== kind || !data.sdp) {
      throw new Error('This is not the expected SyncBeat pairing code.');
    }
    return data;
  }

  async createHostOffer() {
    if (this.role === 'guest') this.disconnectAll();
    this.role = 'host';
    this.clockOffset = 0;
    const exchangeId = Math.random().toString(36).slice(2, 12);
    const pc = this.makePeer();
    const channel = pc.createDataChannel('syncbeat', { ordered: true });
    this.pendingPeers.set(exchangeId, { pc, channel });
    this.configureHostChannel(exchangeId, pc, channel);
    await pc.setLocalDescription(await pc.createOffer());
    await MetronomeSyncEngine.waitForIce(pc);
    MetronomeSyncEngine.ensureCandidates(pc);
    this.notifyConnection();
    return MetronomeSyncEngine.encodeCode({
      app: 'syncbeat', version: 1, kind: 'offer', exchangeId,
      roomId: this.roomId, hostId: this.deviceId, sdp: pc.localDescription
    });
  }

  async acceptOffer(raw) {
    const offer = MetronomeSyncEngine.parseCode(raw, 'offer');
    this.disconnectAll();
    this.role = 'guest';
    this.roomId = offer.roomId || 'MAIN';
    const pc = this.makePeer();
    pc.ondatachannel = (event) => this.configureGuestChannel(pc, event.channel);
    await pc.setRemoteDescription(offer.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await MetronomeSyncEngine.waitForIce(pc);
    MetronomeSyncEngine.ensureCandidates(pc);
    this.notifyConnection();
    return MetronomeSyncEngine.encodeCode({
      app: 'syncbeat', version: 1, kind: 'answer', exchangeId: offer.exchangeId,
      roomId: this.roomId, guestId: this.deviceId, sdp: pc.localDescription
    });
  }

  async acceptAnswer(raw) {
    const answer = MetronomeSyncEngine.parseCode(raw, 'answer');
    const peer = this.pendingPeers.get(answer.exchangeId);
    if (!peer) throw new Error('This response belongs to another or expired invitation.');
    peer.guestId = answer.guestId;
    await peer.pc.setRemoteDescription(answer.sdp);
    if (peer.channel.readyState !== 'open') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The QR exchange completed, but the direct device connection timed out.')), 25000);
        peer.channel.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        peer.channel.addEventListener('close', () => { clearTimeout(timer); reject(new Error('The direct device connection closed before pairing completed.')); }, { once: true });
      });
    }
  }

  configureHostChannel(exchangeId, pc, channel) {
    channel.onopen = () => {
      const pending = this.pendingPeers.get(exchangeId);
      const id = (pending && pending.guestId) || exchangeId;
      this.pendingPeers.delete(exchangeId);
      this.hostPeers.set(id, { pc, channel });
      this.send(channel, { type: 'STATE', payload: this.snapshot() });
      this.notifyConnection();
    };
    channel.onmessage = (event) => this.handleHostMessage(channel, event.data);
    channel.onclose = () => {
      for (const [id, peer] of this.hostPeers) if (peer.channel === channel) this.hostPeers.delete(id);
      this.pendingPeers.delete(exchangeId);
      this.notifyConnection();
    };
    pc.onconnectionstatechange = () => {
      if (this.onPeerState) this.onPeerState(pc.connectionState, 'host');
      if (['failed', 'closed'].includes(pc.connectionState)) channel.close();
    };
    pc.oniceconnectionstatechange = () => {
      if (this.onPeerState) this.onPeerState(pc.iceConnectionState, 'host');
    };
  }

  configureGuestChannel(pc, channel) {
    this.hostPeer = { pc, channel };
    channel.onopen = () => { this.startClockSync(); this.notifyConnection(); };
    channel.onmessage = (event) => this.handleGuestMessage(event.data);
    channel.onclose = () => { this.stopClockSync(); this.notifyConnection(); };
    pc.onconnectionstatechange = () => {
      if (this.onPeerState) this.onPeerState(pc.connectionState, 'guest');
      if (['failed', 'closed'].includes(pc.connectionState)) channel.close();
    };
    pc.oniceconnectionstatechange = () => {
      if (this.onPeerState) this.onPeerState(pc.iceConnectionState, 'guest');
    };
  }

  send(channel, message) {
    if (channel && channel.readyState === 'open') channel.send(JSON.stringify(message));
  }

  broadcast(message) {
    for (const peer of this.hostPeers.values()) this.send(peer.channel, message);
  }

  snapshot() {
    return {
      isPlaying: this.isPlaying, bpm: this.bpm, beatsPerMeasure: this.beatsPerMeasure, noteValue: this.noteValue, accentPattern: this.accentPattern,
      startMasterTime: this.startMasterTime, soundType: this.audio.soundType || 'synth', appState: this.appState, bandState: this.bandState
    };
  }

  handleHostMessage(channel, raw) {
    try {
      const message = JSON.parse(raw);
      if (message.type === 'PING') {
        this.send(channel, { type: 'PONG', payload: {
          clientSendTime: message.payload.clientSendTime, hostTime: Date.now()
        }});
      } else if (message.type === 'COMMAND') {
        this.applyHostCommand(message.payload);
      }
    } catch (error) { console.warn('Invalid peer message', error); }
  }

  handleGuestMessage(raw) {
    try {
      const message = JSON.parse(raw);
      if (message.type === 'PONG') {
        const now = Date.now();
        const rtt = now - message.payload.clientSendTime;
        this.pings.push({ rtt, offset: message.payload.hostTime + rtt / 2 - now });
        this.pings.sort((a, b) => a.rtt - b.rtt);
        this.pings = this.pings.slice(0, 10);
        this.rtt = Math.round(this.pings[0].rtt);
        this.clockOffset = this.pings[0].offset;
        this.notifyConnection();
      } else if (message.type === 'STATE') {
        this.applyState(message.payload);
      } else if (message.type === 'EVENT') {
        this.applyEvent(message.payload);
      }
    } catch (error) { console.warn('Invalid host message', error); }
  }

  startClockSync() {
    this.stopClockSync();
    const ping = () => this.send(this.hostPeer && this.hostPeer.channel, {
      type: 'PING', payload: { clientSendTime: Date.now() }
    });
    for (let i = 0; i < 6; i += 1) setTimeout(ping, i * 150);
    this.pingTimer = setInterval(ping, 4000);
  }

  stopClockSync() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pings = [];
  }

  applyState(state) {
    this.bpm = state.bpm;
    this.beatsPerMeasure = state.beatsPerMeasure;
    if (state.noteValue) this.noteValue = state.noteValue;
    if (state.accentPattern) this.accentPattern = state.accentPattern;
    if (state.soundType) this.audio.setSoundType(state.soundType);
    if (state.bandState) { this.bandState = state.bandState; if (this.onAppEvent) this.onAppEvent(state.bandState); }
    if (state.appState) { this.appState = state.appState; if (this.onAppEvent) this.onAppEvent(state.appState); }
    if (state.isPlaying && state.startMasterTime) {
      this.startPlayback(state.startMasterTime, state.bpm, state.beatsPerMeasure);
    } else {
      this.stopPlayback();
    }
    if (this.onStateChange) this.onStateChange();
  }

  applyEvent(event) {
    if (this.role === 'guest' && this.followingPaused) {
      if (event.action === 'START') this.pausedHostState = { startMasterTime: event.startMasterTime, bpm: event.bpm || this.bpm, beatsPerMeasure: event.beatsPerMeasure || this.beatsPerMeasure };
      if (event.action === 'STOP') this.pausedHostState = null;
      if (event.action === 'TEMPO') { this.bpm = event.bpm; if (this.pausedHostState) this.pausedHostState.bpm = event.bpm; }
      if (event.action === 'SIGNATURE') { this.beatsPerMeasure = event.beatsPerMeasure; this.noteValue = event.noteValue; this.accentPattern = event.accentPattern; if (this.pausedHostState) this.pausedHostState.beatsPerMeasure = event.beatsPerMeasure; }
      if (event.action === 'ACCENTS') this.accentPattern = event.accentPattern;
      if (event.action === 'SOUND') this.audio.setSoundType(event.soundType);
      if (event.action === 'APP' && this.onAppEvent) this.onAppEvent(event.payload);
      if (this.onStateChange) this.onStateChange();
      return;
    }
    if (event.action === 'START') this.startPlayback(event.startMasterTime, event.bpm, event.beatsPerMeasure);
    if (event.action === 'STOP') this.stopPlayback();
    if (event.action === 'TEMPO') {
      this.bpm = event.bpm;
      if (event.startMasterTime) this.startPlayback(event.startMasterTime, this.bpm, this.beatsPerMeasure);
    }
    if (event.action === 'BEATS') this.beatsPerMeasure = event.beatsPerMeasure;
    if (event.action === 'SIGNATURE') { this.beatsPerMeasure = event.beatsPerMeasure; this.noteValue = event.noteValue; this.accentPattern = event.accentPattern; }
    if (event.action === 'ACCENTS') this.accentPattern = event.accentPattern;
    if (event.action === 'SOUND') this.audio.setSoundType(event.soundType);
    if (event.action === 'APP' && this.onAppEvent) this.onAppEvent(event.payload);
    if (this.onStateChange) this.onStateChange();
  }

  applyHostCommand(command) {
    const event = Object.assign({}, command);
    if (event.action === 'START') {
      event.bpm = event.bpm || this.bpm;
      event.beatsPerMeasure = event.beatsPerMeasure || this.beatsPerMeasure;
      event.startMasterTime = Date.now() + 700;
    }
    if (event.action === 'TEMPO' && this.isPlaying) event.startMasterTime = Date.now() + 500;
    this.applyEvent(event);
    this.broadcast({ type: 'EVENT', payload: event });
  }

  sendCommand(command) {
    if (this.role === 'guest') return false;
    this.applyHostCommand(command);
    return true;
  }

  sendStart(bpm, beatsPerMeasure) { this.audio.init(); this.sendCommand({ action: 'START', bpm, beatsPerMeasure }); }
  sendStop() { this.sendCommand({ action: 'STOP' }); }
  sendTempo(bpm) { this.bpm = bpm; this.sendCommand({ action: 'TEMPO', bpm }); }
  sendBeatsPerMeasure(beatsPerMeasure) {
    this.beatsPerMeasure = beatsPerMeasure;
    this.accentPattern = Array.from({ length: beatsPerMeasure }, (_, i) => i === 0 ? 'accent' : 'normal');
    this.sendCommand({ action: 'BEATS', beatsPerMeasure });
  }
  sendAccentPattern(accentPattern) {
    this.accentPattern = accentPattern.slice();
    this.sendCommand({ action: 'ACCENTS', accentPattern: this.accentPattern });
  }
  sendTimeSignature(beatsPerMeasure, noteValue) {
    this.beatsPerMeasure = beatsPerMeasure;
    this.noteValue = noteValue;
    this.accentPattern = Array.from({ length: beatsPerMeasure }, (_, i) => i === 0 ? 'accent' : 'normal');
    this.sendCommand({ action: 'SIGNATURE', beatsPerMeasure, noteValue, accentPattern: this.accentPattern });
  }
  sendSoundType(soundType) {
    this.audio.setSoundType(soundType);
    this.sendCommand({ action: 'SOUND', soundType });
  }

  sendAppEvent(payload) {
    if (this.role === 'guest') return false;
    if (payload && payload.type === 'SETLIST_SYNC') this.bandState = payload;
    if (payload && (payload.type === 'SONG' || payload.type === 'SECTION')) this.appState = payload;
    this.broadcast({ type: 'EVENT', payload: { action: 'APP', payload } });
    return true;
  }

  pauseFollowing() {
    if (this.role !== 'guest' || this.followingPaused) return;
    this.followingPaused = true;
    if (this.isPlaying && this.startMasterTime) this.pausedHostState = { startMasterTime: this.startMasterTime, bpm: this.bpm, beatsPerMeasure: this.beatsPerMeasure };
    this.isPlaying = false;
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.schedulerTimer = null;
    this.animationFrameId = null;
    if (this.onStateChange) this.onStateChange();
  }

  resumeFollowing() {
    if (this.role !== 'guest' || !this.followingPaused) return;
    this.followingPaused = false;
    const state = this.pausedHostState;
    if (state) this.startPlayback(state.startMasterTime, state.bpm, state.beatsPerMeasure);
    if (this.onStateChange) this.onStateChange();
  }

  disconnectAll() {
    this.stopClockSync();
    for (const peer of this.hostPeers.values()) peer.pc.close();
    for (const peer of this.pendingPeers.values()) peer.pc.close();
    if (this.hostPeer) this.hostPeer.pc.close();
    this.hostPeers.clear();
    this.pendingPeers.clear();
    this.hostPeer = null;
    this.role = 'standalone';
    this.clockOffset = 0;
    this.rtt = 0;
    this.notifyConnection();
  }

  startPlayback(startMasterTime, bpm, beatsPerMeasure) {
    this.audio.init();
    this.isPlaying = true;
    this.startMasterTime = startMasterTime;
    this.bpm = bpm;
    this.beatsPerMeasure = beatsPerMeasure;
    const interval = 60000 / bpm;
    const now = this.getMasterNow();
    this.nextBeatNumber = now >= startMasterTime ? Math.floor((now - startMasterTime) / interval) + 1 : 0;
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = setInterval(() => this.runScheduler(), 20);
    this.startVisualLoop();
  }

  stopPlayback() {
    this.isPlaying = false;
    this.startMasterTime = null;
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.schedulerTimer = null;
    this.animationFrameId = null;
    this.lastVisualBeat = -1;
  }

  runScheduler() {
    if (!this.isPlaying || !this.startMasterTime) return;
    const interval = 60000 / this.bpm;
    const masterNow = this.getMasterNow();
    const audioNow = this.audio.getCurrentAudioTime();
    const horizon = masterNow + 200;
    while (true) {
      const target = this.startMasterTime + this.nextBeatNumber * interval;
      if (target > horizon) break;
      const audioTarget = audioNow + (target - masterNow) / 1000;
      if (audioTarget >= audioNow - 0.02) {
        const beatIndex = this.nextBeatNumber % this.beatsPerMeasure;
        this.audio.scheduleBeat(audioTarget, this.accentPattern[beatIndex] || (beatIndex === 0 ? 'accent' : 'normal'));
      }
      this.nextBeatNumber += 1;
    }
  }

  startVisualLoop() {
    const frame = () => {
      if (!this.isPlaying || !this.startMasterTime) return;
      const elapsed = this.getMasterNow() - this.startMasterTime;
      if (elapsed >= 0) {
        const index = Math.floor(elapsed / (60000 / this.bpm));
        if (index !== this.lastVisualBeat) {
          this.lastVisualBeat = index;
          const beat = index % this.beatsPerMeasure + 1;
          if (this.onBeat) this.onBeat(beat, beat === 1);
        }
      }
      this.animationFrameId = requestAnimationFrame(frame);
    };
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = requestAnimationFrame(frame);
  }
}

window.MetronomeSyncEngine = MetronomeSyncEngine;
