/**
 * Precision Web Audio API Metronome Synthesizer
 */
class MetronomeAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.soundType = 'synth'; // 'synth', 'woodblock', 'rimshot'
    this.volume = 0.9;
    this.beatGain = 1;
    this.isMuted = false;
    this.isUnlocked = false;
  }

  // Initialize and unlock audio context for iOS Safari and Android
  init() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    this.unlock();
  }

  unlock() {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    // Play a tiny silent buffer to warm up iOS hardware
    if (!this.isUnlocked) {
      try {
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
        this.isUnlocked = true;
      } catch (e) {
        console.warn('Audio unlock warning:', e);
      }
    }
  }

  setSoundType(type) {
    this.soundType = type;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
  }

  setMuted(muted) {
    this.isMuted = muted;
  }

  getCurrentAudioTime() {
    if (!this.audioCtx) this.init();
    return this.audioCtx.currentTime;
  }

  /**
   * Schedule a single beat sound at exact AudioContext time
   * @param {number} time - AudioContext timestamp (seconds)
   * @param {boolean} isAccent - Whether this is Beat 1
   */
  scheduleBeat(time, accent = false) {
    if (!this.audioCtx || this.isMuted) return;
    if (accent === 'muted') return;
    if ((this.soundType === 'voice_en' || this.soundType === 'voice_zh') && 'speechSynthesis' in window) return;
    const isAccent = accent === true || accent === 'accent';
    this.beatGain = accent === 'soft' ? 0.38 : 1;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const t = Math.max(time, this.audioCtx.currentTime);

    switch (this.soundType) {
      case 'woodblock':
        this.playWoodblock(t, isAccent);
        break;
      case 'rimshot':
        this.playRimshot(t, isAccent);
        break;
      case 'synth':
      default:
        this.playSynthClick(t, isAccent);
        break;
    }
  }

  speakCount(beat) {
    if (this.isMuted || !('speechSynthesis' in window)) return;
    const counts = this.soundType === 'voice_zh' ? ['一', '二', '三', '四'] : ['one', 'two', 'three', 'four'];
    const utterance = new SpeechSynthesisUtterance(counts[(beat - 1) % 4]);
    utterance.lang = this.soundType === 'voice_zh' ? 'zh-TW' : 'en-US';
    utterance.rate = Math.min(2, Math.max(0.8, this.soundType === 'voice_zh' ? 1.65 : 1.8));
    utterance.pitch = beat === 1 ? 1.2 : 1;
    utterance.volume = this.volume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  // Clean Electronic Metronome Beep
  playSynthClick(time, isAccent) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1760 : 880, time); // A6 or A5

    const baseVol = isAccent ? this.volume : this.volume * this.beatGain * 0.7;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(baseVol, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (isAccent ? 0.08 : 0.05));

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(time);
    osc.stop(time + 0.1);
  }

  // Natural Woodblock Tone
  playWoodblock(time, isAccent) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const filter = this.audioCtx.createBiquadFilter();

    osc.type = 'triangle';
    const freq = isAccent ? 1200 : 800;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, time + 0.04);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, time);
    filter.Q.setValueAtTime(6, time);

    const baseVol = isAccent ? this.volume * this.beatGain * 1.2 : this.volume * this.beatGain * 0.9;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(baseVol, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(time);
    osc.stop(time + 0.07);
  }

  // Crisp Drum Rimshot Tone
  playRimshot(time, isAccent) {
    // 1. Noise transient
    const bufferSize = this.audioCtx.sampleRate * 0.03;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(isAccent ? 2000 : 1500, time);

    const noiseGain = this.audioCtx.createGain();
    noiseGain.gain.setValueAtTime(this.volume * this.beatGain * (isAccent ? 0.8 : 0.5), time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.audioCtx.destination);

    // 2. High body tone
    const osc = this.audioCtx.createOscillator();
    const oscGain = this.audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(isAccent ? 1400 : 1000, time);

    oscGain.gain.setValueAtTime(this.volume * this.beatGain * (isAccent ? 0.6 : 0.4), time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    osc.connect(oscGain);
    oscGain.connect(this.audioCtx.destination);

    noise.start(time);
    noise.stop(time + 0.035);
    osc.start(time);
    osc.stop(time + 0.045);
  }
}

window.MetronomeAudioEngine = MetronomeAudioEngine;
