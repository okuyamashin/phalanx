// スマホの動きのセンサーで「平らにして突き出す」を見分ける部品。
//
//   平ら   : 画面が上を向いて、ほぼ水平（重力がほぼ画面に垂直）
//   突き出し: 平らなまま、水平方向に強く動かす
//
// 突き出しを見つけたら onThrust() を呼ぶ。タップと同じ合図として使う。
// iPhone はセンサーを使う前に許可が要る。許可はタップなどの操作の中でしか頼めないので、
// ボタンを押したときに start() を呼ぶ。

const DEFAULTS = {
  flatDeg: 35,      // 水平からこれ以内なら「平ら」
  jab: 13,          // 水平方向の加速度がこれ（m/s²）を超えたら突き出し
  cooldown: 450,    // 止めるときの揺れで二重に出ないよう、この間（ms）は次を受け付けない
};

export function motionThrust({ onThrust = () => {}, onState = () => {}, ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const cosFlat = Math.cos(cfg.flatDeg * Math.PI / 180);
  // state: 'off'（未対応・未許可）| 'needs-permission' | 'on'
  let state = 'off', flat = false, last = 0;
  let gx = 0, gy = 0, gz = 0, haveG = false; // 重力の向き（ゆっくり追う）
  const api = { get state() { return state; }, get flat() { return flat; }, peak: 0, start, cfg };

  function setState(s) { if (s !== state) { state = s; onState(state, flat); } }

  function onMotion(e) {
    const ag = e.accelerationIncludingGravity;
    if (!ag || ag.x == null) return;
    if (state !== 'on') setState('on');
    // 重力：重力込みの値をならしたもの
    const k = haveG ? 0.12 : 1;
    gx += (ag.x - gx) * k; gy += (ag.y - gy) * k; gz += (ag.z - gz) * k; haveG = true;
    const gl = Math.hypot(gx, gy, gz) || 1;
    const nowFlat = Math.abs(gz) / gl > cosFlat;
    if (nowFlat !== flat) { flat = nowFlat; onState(state, flat); }

    // 動きだけの加速度。端末が出してくれなければ、重力込みの値から重力を引く
    const a = e.acceleration && e.acceleration.x != null ? e.acceleration : { x: ag.x - gx, y: ag.y - gy, z: ag.z - gz };
    // 平らなときは画面の面（x と y）が水平方向
    const h = Math.hypot(a.x, a.y);
    api.peak = Math.max(api.peak * 0.97, h); // 調整用に、最近の最大値を残す
    const now = performance.now();
    if (flat && h > cfg.jab && now - last > cfg.cooldown) { last = now; onThrust(); }
  }

  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    addEventListener('devicemotion', onMotion);
  }

  // 許可が要らない端末（Android など）は、すぐ聞き始める。値が来れば 'on' になる
  const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  if (typeof DeviceMotionEvent === 'undefined') setState('off');
  else if (needsPermission) setState('needs-permission');
  else listen();

  // ボタンを押したときに呼ぶ。iPhone ではここで許可を頼む
  async function start() {
    if (state !== 'needs-permission') return;
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r === 'granted') listen(); else setState('off');
    } catch { setState('off'); }
  }
  return api;
}
