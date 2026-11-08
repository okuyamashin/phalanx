// スマホのマイクで、短く強い声（「えい！」など）を見分ける部品。
//
// 言葉を聞き分ける音声認識は結果が出るまで1秒近くかかるので使わない。
// 代わりに、周りの静かさより急に大きな音が入った瞬間を合図にする。
// 見つけたら onThrust() を呼ぶ。タップと同じ合図として使う。
//
// マイクは許可が要り、音を扱う仕組み（AudioContext）も操作の中でしか動かせないので、
// ボタンを押して指を離したときに start() を呼ぶ。

const DEFAULTS = {
  level: 0.08,     // これより大きい音量（0〜1 の実効値）で合図。静かな部屋は 0.005 前後
  ratio: 3,        // 周りの音の大きさの、この倍を超えたときだけ合図（騒がしい場所での出すぎを防ぐ）
  cooldown: 450,   // 声の響きで二重に出ないよう、この間（ms）は次を受け付けない
};

export function voiceThrust({ onThrust = () => {}, onState = () => {}, ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  // state: 'idle'（まだ始めていない）| 'starting' | 'on' | 'denied' | 'off'（マイクがない）
  let state = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? 'idle' : 'off';
  let ac = null, analyser = null, buf = null, timer = 0;
  let floor = 0.01, loud = false, last = 0;
  const api = { get state() { return state; }, level: 0, peak: 0, floor: 0, start, cfg };

  function setState(s) { if (s !== state) { state = s; onState(state); } }

  async function start() {
    if (state === 'on' && ac && ac.state === 'suspended') { ac.resume(); return; }
    if (state !== 'idle') return;
    setState('starting');
    try {
      // 音量を正しく測るため、自動の音量調整やノイズ除去は切る
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') await ac.resume();
      const src = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      buf = new Float32Array(analyser.fftSize);
      src.connect(analyser); // スピーカーにはつながない（ハウリングしないように）
      setState('on');
      timer = setInterval(tick, 16);
    } catch (err) {
      console.warn('[voice]', err);
      setState(err && err.name === 'NotAllowedError' ? 'denied' : 'off');
    }
  }

  function tick() {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    api.level = rms;
    api.peak = Math.max(api.peak * 0.98, rms);
    // 周りの音の大きさ：下がるときは速く、上がるときはゆっくり追う。声が出ている間はさらにゆっくり
    // （短い声はほとんど覚えず、ずっと続く騒がしさには数秒で慣れる）
    floor += (rms - floor) * (rms < floor ? 0.05 : loud ? 0.004 : 0.01);
    floor = Math.max(floor, 0.002);
    api.floor = floor;

    const over = rms > cfg.level && rms > floor * cfg.ratio;
    const now = performance.now();
    // 静かな状態から大きくなった瞬間だけを合図にする（叫び続けても連発しない）
    if (over && !loud && now - last > cfg.cooldown) { last = now; onThrust(); }
    // 声が収まったら、次の声を受け付ける。騒がしい場所では、周りの音の大きさ近くまで下がれば収まったとみなす
    loud = over || (loud && rms > Math.max(cfg.level * 0.5, floor * 1.5));
  }

  // 裏に回ると止まることがあるので、戻ったら動かし直す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ac && ac.state === 'suspended') ac.resume();
  });
  return api;
}
