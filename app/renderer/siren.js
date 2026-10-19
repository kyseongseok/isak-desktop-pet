// 근무확인 사이렌: 소리는 Web Audio로 합성(파일 없음), 화면은 전체 색 레이어 깜빡임
// 설정: theme(quiet|club|ambulance|police), volume(0~100)
// 단계별 세기: 5분 전 작고 느리게 → 3분 전 중간 → 1분 전·초과 풀 세기
'use strict';
const siren = (() => {
  const settings = { theme: 'quiet', volume: 40 };
  let ctx = null, master = null, running = [], stageGain = 1;
  const flash = document.getElementById('flash');

  function audio() {
    if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.value = settings.volume / 100 * 0.5 * stageGain;
    return ctx;
  }
  function stopAll() { running.forEach(fn => { try { fn(); } catch (e) {} }); running = []; }

  // 짧은 알림음 "딩동"
  function chime(times = 1) {
    const c = audio(), t0 = c.currentTime;
    for (let i = 0; i < times; i++) {
      [880, 1174.7].forEach((f, j) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = t0 + i * 0.5 + j * 0.18;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.45);
      });
    }
  }
  // 🚑 두 음이 번갈아
  function ambulance(soft) {
    const c = audio();
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 2200;
    g.gain.value = soft ? 0.25 : 0.5;
    o.connect(lp); lp.connect(g); g.connect(master);
    const period = soft ? 1.2 : 0.6;
    let t = c.currentTime;
    const timer = setInterval(() => {
      while (t < c.currentTime + 1) { o.frequency.setValueAtTime(960, t); o.frequency.setValueAtTime(770, t + period / 2); t += period; }
    }, 300);
    o.start();
    running.push(() => { clearInterval(timer); g.gain.setTargetAtTime(0, c.currentTime, 0.05); o.stop(c.currentTime + 0.3); });
  }
  // 🚓 올라갔다 내려오는 사이렌
  function police(soft) {
    const c = audio();
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.gain.value = soft ? 0.18 : 0.35;
    o.connect(lp); lp.connect(g); g.connect(master);
    const period = soft ? 2.4 : 1.4;
    let t = c.currentTime;
    const timer = setInterval(() => {
      while (t < c.currentTime + 1) {
        o.frequency.setValueAtTime(600, t);
        o.frequency.exponentialRampToValueAtTime(1300, t + period / 2);
        o.frequency.exponentialRampToValueAtTime(600, t + period);
        t += period;
      }
    }, 300);
    o.start();
    running.push(() => { clearInterval(timer); g.gain.setTargetAtTime(0, c.currentTime, 0.05); o.stop(c.currentTime + 0.3); });
  }
  // 🪩 128 BPM 킥 + 하이햇 + 신스 스탭 + 베이스. 짧게 끊기는 소리라 사이렌보다 작게 들려서 전체적으로 세게 잡음
  function club(soft) {
    const c = audio();
    const beat = 60 / 128, vol = soft ? 0.6 : 1;
    const noiseBuf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const bass = [55, 55, 65.4, 49];
    let bar = 0, t = c.currentTime + 0.05;
    const kick = (at) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
      g.gain.setValueAtTime(1.3 * vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      o.connect(g); g.connect(master); o.start(at); o.stop(at + 0.3);
    };
    const hat = (at) => {
      const s = c.createBufferSource(), g = c.createGain(), hp = c.createBiquadFilter();
      s.buffer = noiseBuf; hp.type = 'highpass'; hp.frequency.value = 7000;
      g.gain.setValueAtTime(0.4 * vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      s.connect(hp); hp.connect(g); g.connect(master); s.start(at); s.stop(at + 0.06);
    };
    const stab = (at, f) => [f * 4, f * 5, f * 6].forEach(freq => {
      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = freq; lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2500, at); lp.frequency.exponentialRampToValueAtTime(400, at + 0.2);
      g.gain.setValueAtTime(0.2 * vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      o.connect(lp); lp.connect(g); g.connect(master); o.start(at); o.stop(at + 0.25);
    });
    const bassNote = (at, f) => {                       // 8분음표 베이스: 킥 사이를 채워 소리가 끊기지 않게
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.55 * vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, at + beat * 0.45);
      o.connect(g); g.connect(master); o.start(at); o.stop(at + beat * 0.5);
    };
    const timer = setInterval(() => {
      while (t < c.currentTime + 0.6) {
        const f = bass[bar % 4];
        for (let b = 0; b < 4; b++) { kick(t + b * beat); hat(t + b * beat + beat / 2); bassNote(t + b * beat + beat / 2, f); if (b % 2) stab(t + b * beat + beat / 2, f); }
        t += beat * 4; bar++;
      }
    }, 200);
    running.push(() => clearInterval(timer));
  }
  const SOUND = { club, ambulance, police };

  // stage: 1=5분 전(작게·느리게), 2=3분 전(중간), 3=1분 전, 4=마감 초과(풀 세기)
  function play(stage) {
    stopAll(); flash.className = '';
    stageGain = { 1: 0.45, 2: 0.7 }[stage] || 1;
    if (settings.theme === 'quiet') { chime(Math.min(stage, 3)); return; }
    SOUND[settings.theme](stage === 1);
    flash.className = settings.theme + (stage === 1 ? ' soft' : '');
  }
  function stop() { stopAll(); flash.className = ''; }
  // 테마 고를 때 3초 미리 듣기
  function preview(theme) {
    const saved = settings.theme; settings.theme = theme;
    play(3); settings.theme = saved;
    setTimeout(stop, 3000);
  }
  function configure(partial) { Object.assign(settings, partial); if (master) master.gain.value = settings.volume / 100 * 0.5 * stageGain; }

  // 집중 타이머 종료: 부드러운 종소리 두 번 (사이렌 테마와 무관, 볼륨 설정만 공유)
  function bell() {
    stageGain = 0.8; const c = audio(), t0 = c.currentTime;
    [0, 0.55].forEach(d => [659.3, 987.8, 1318.5].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      const t = t0 + d; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 / (i + 1), t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.5);
    }));
  }
  return { play, stop, preview, configure, settings, bell };
})();
