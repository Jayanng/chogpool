// Race-day sound cues, synthesized in the browser (no audio files, nothing to
// download). The show ships muted: sound is opt-in through the on-screen
// toggle and the choice is remembered in this browser.

const STORAGE_KEY = "chogtrack.sound.v1";

let muted = true;
try {
  muted = window.localStorage.getItem(STORAGE_KEY) !== "on";
} catch {
  muted = true;
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
  } catch {
    // Preference is simply session-scoped when storage is unavailable.
  }
}

type CueName = "gates" | "finish" | "fanfare";

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (muted) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(ctx: AudioContext, freq: number, start: number, duration: number, gain: number, type: OscillatorType = "triangle") {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

/** Play a short cue. Silent when the show is muted (the default). */
export function playCue(cue: CueName): void {
  const ctx = audio();
  if (!ctx) return;
  if (cue === "gates") {
    tone(ctx, 220, 0, 0.18, 0.18, "square");
    tone(ctx, 330, 0.12, 0.22, 0.18, "square");
  } else if (cue === "finish") {
    tone(ctx, 196, 0, 0.12, 0.16);
    tone(ctx, 294, 0.1, 0.12, 0.16);
    tone(ctx, 392, 0.2, 0.3, 0.2);
  } else {
    const notes = [261.6, 329.6, 392.0, 523.3];
    notes.forEach((freq, i) => tone(ctx, freq, i * 0.14, 0.5, 0.14));
  }
}
