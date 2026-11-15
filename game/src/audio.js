// NEON RUSH — sound, synthesized live with WebAudio.
// No audio files: engine hum (oscillator pitch follows speed), boost whoosh
// (filtered noise), countdown beeps, UI clicks, and a finish fanfare. The
// AudioContext is created on the first user gesture; until then every call
// is a harmless no-op, so headless screenshot runs stay silent and safe.

export function makeAudio() {
  return {
    ctx: null,
    engineOsc: null,
    engineGain: null,
    noiseBuffer: null,
    muted: false,
    whooshGain: null,
  };
}

export function ensureAudio(audio) {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio.ctx = new Ctx();
    // Engine: two detuned sawtooths through a low-pass filter.
    audio.engineOsc = audio.ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 60;
    const second = audio.ctx.createOscillator();
    second.type = 'sawtooth';
    second.frequency.value = 61.5;
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0;
    const filter = audio.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    audio.engineOsc.connect(filter);
    second.connect(filter);
    filter.connect(audio.engineGain);
    audio.engineGain.connect(audio.ctx.destination);
    audio.engineOsc.start();
    second.start();
    audio.engineSecond = second;
    // One second of white noise, reused for whooshes and sparks. Generated
    // from a fixed-seed LCG so even the audio buffer is deterministic.
    const len = audio.ctx.sampleRate;
    audio.noiseBuffer = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const data = audio.noiseBuffer.getChannelData(0);
    let noiseSeed = 123456789;
    for (let i = 0; i < len; i += 1) {
      noiseSeed = (Math.imul(noiseSeed, 1103515245) + 12345) >>> 0;
      data[i] = noiseSeed / 2147483648 - 1;
    }
    audio.whooshGain = audio.ctx.createGain();
    audio.whooshGain.gain.value = 0;
    audio.whooshGain.connect(audio.ctx.destination);
  } catch {
    audio.ctx = null;
  }
}

// Engine pitch + volume follow the player's speed (0..1) and boost state.
export function updateEngineSound(audio, speedNorm, boosting) {
  if (!audio.ctx || !audio.engineOsc || audio.muted) return;
  const t = audio.ctx.currentTime;
  const freq = 55 + speedNorm * 190 + (boosting ? 45 : 0);
  audio.engineOsc.frequency.setTargetAtTime(freq, t, 0.06);
  audio.engineSecond.frequency.setTargetAtTime(freq * 1.015, t, 0.06);
  audio.engineGain.gain.setTargetAtTime(
    0.028 + speedNorm * 0.05 + (boosting ? 0.02 : 0),
    t,
    0.1,
  );
}

export function stopEngineSound(audio) {
  if (!audio.ctx || !audio.engineGain) return;
  audio.engineGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
}

function beep(audio, freq, duration, volume, when) {
  if (!audio.ctx || audio.muted) return;
  const t = audio.ctx.currentTime + (when || 0);
  const osc = audio.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export function playCountdownBeep(audio, isGo) {
  beep(audio, isGo ? 880 : 440, isGo ? 0.5 : 0.18, 0.16);
}

export function playClick(audio) {
  beep(audio, 660, 0.07, 0.1);
}

export function playBoostWhoosh(audio) {
  if (!audio.ctx || !audio.noiseBuffer || audio.muted) return;
  const t = audio.ctx.currentTime;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(0.22, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.ctx.destination);
  src.start(t);
  src.stop(t + 0.5);
}

export function playScrape(audio) {
  if (!audio.ctx || !audio.noiseBuffer || audio.muted) return;
  const t = audio.ctx.currentTime;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1800;
  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.ctx.destination);
  src.start(t);
  src.stop(t + 0.2);
}

// Little rising arpeggio when the player finishes on the podium.
export function playFanfare(audio) {
  if (!audio.ctx || audio.muted) return;
  [523, 659, 784, 1047].forEach((freq, i) => {
    beep(audio, freq, 0.35, 0.14, i * 0.13);
  });
}

export function toggleMute(audio) {
  audio.muted = !audio.muted;
  if (audio.muted) stopEngineSound(audio);
  return audio.muted;
}
