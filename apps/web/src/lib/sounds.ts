export function playJoinSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";

    // Play a rising chime: C5 (523.25Hz) then E5 (659.25Hz)
    osc1.frequency.setValueAtTime(523.25, t);
    osc2.frequency.setValueAtTime(659.25, t + 0.15);

    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.3, t + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(t);
    osc1.stop(t + 0.15);
    
    osc2.start(t + 0.15);
    osc2.stop(t + 0.6);
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}

export function playLeaveSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";

    // Play a falling chime: E5 (659.25Hz) then C5 (523.25Hz)
    osc1.frequency.setValueAtTime(659.25, t);
    osc2.frequency.setValueAtTime(523.25, t + 0.15);

    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.2, t + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(t);
    osc1.stop(t + 0.15);

    osc2.start(t + 0.15);
    osc2.stop(t + 0.6);
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}

export function playMuteSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // A subtle low "boop"
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);

    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.2);
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}

export function playUnmuteSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // A subtle rising "boop" — inverse of mute
    osc.type = "sine";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(350, t + 0.1);

    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.2, t + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.2);
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}

export function playScreenshareSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    // Two-tone notification chord — distinct from join/leave
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const osc3 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "triangle";
    osc2.type = "triangle";
    osc3.type = "sine";

    // A5 (880Hz) + C#6 (1108.73Hz) chord, then E6 (1318.5Hz)
    osc1.frequency.setValueAtTime(880, t);
    osc2.frequency.setValueAtTime(1108.73, t);
    osc3.frequency.setValueAtTime(1318.5, t + 0.12);

    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.15, t + 0.03);
    gainNode.gain.linearRampToValueAtTime(0.12, t + 0.12);
    gainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    osc3.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(t);
    osc1.stop(t + 0.12);
    osc2.start(t);
    osc2.stop(t + 0.12);
    osc3.start(t + 0.12);
    osc3.stop(t + 0.5);
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}

export function playNotificationSound(presetName: string) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const t = ctx.currentTime;

    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);

    if (presetName === "sakura_pop") {
      // Sweet, soft double-tone bell chime: E6 (1318.51Hz) then G#6 (1661.22Hz)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sine";
      osc2.type = "sine";

      osc1.frequency.setValueAtTime(1318.51, t);
      osc2.frequency.setValueAtTime(1661.22, t + 0.08);

      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.005, t + 0.4);

      osc1.connect(gainNode);
      osc2.connect(gainNode);

      osc1.start(t);
      osc1.stop(t + 0.4);
      osc2.start(t + 0.08);
      osc2.stop(t + 0.4);
    } else if (presetName === "bubble_tap") {
      // Watery bubble pop sound
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);

      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.15, t + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.005, t + 0.08);

      osc.connect(gainNode);
      osc.start(t);
      osc.stop(t + 0.08);
    } else if (presetName === "crystal_ring") {
      // Pure, high-pitched crystal glass chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sine";
      osc2.type = "triangle";

      osc1.frequency.setValueAtTime(2000, t);
      osc2.frequency.setValueAtTime(1000, t);

      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.06, t + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

      osc1.connect(gainNode);
      osc2.connect(gainNode);

      osc1.start(t);
      osc1.stop(t + 0.6);
      osc2.start(t);
      osc2.stop(t + 0.6);
    } else if (presetName === "digital_beep") {
      // Low-key blip/beep
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);

      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.1, t + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.005, t + 0.12);

      osc.connect(gainNode);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  } catch (e) {
    console.warn("AudioContext failed to play sound", e);
  }
}
