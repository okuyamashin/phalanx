// スマホ（コントローラー）とパソコン（ホスト）を WebRTC でつなぐ部品。
// PeerJS（グローバルの Peer）を使う。最初のつなぎ込みだけ PeerJS Cloud を通り、
// つながったあとは端末どうしで直接やりとりする。
//
// メッセージ（JSON）
//   スマホ → ホスト : {t:'hello', v}  {t:'thrust', seq}  {t:'ping', t0, rtt}
//   ホスト → スマホ : {t:'pong', t0}  {t:'state', phase}（phase = gate / title / play / win / lose）

export const PROTOCOL = 1;
const PREFIX = 'phalanx-';

function randomId(n = 8) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; // 読み違えやすい l, o, 0, 1 は使わない
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => abc[x % abc.length]).join('');
}

// ===== ホスト（ゲーム画面）=====
// onThrust() : スマホのボタンが押された
// onStatus(s): 'connecting' | 'waiting'（QR待ち）| 'linked' | 'error'
// onRtt(ms)  : スマホが測った往復の時間（2秒ごと）
export function hostLink({ onThrust = () => {}, onStatus = () => {}, onRtt = () => {} } = {}) {
  let peer = null, conn = null, lastSeq = -1, lastSeen = 0;
  const api = { id: null, padUrl: null, linked: false, rtt: null, send };

  // スマホのタブが閉じられたりスリープしたりしても、close が届かないことがある。
  // スマホは2秒ごとに ping を送るので、5秒なにも来なければ切れたとみなす
  const TIMEOUT = 5000;
  function drop(c) {
    if (conn !== c) return;
    conn = null; api.linked = false; api.rtt = null; onStatus('waiting');
    try { c.close(); } catch {}
  }
  setInterval(() => { if (conn && performance.now() - lastSeen > TIMEOUT) drop(conn); }, 1000);

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  function start(id) {
    peer = new Peer(PREFIX + id);
    onStatus('connecting');
    peer.on('open', () => {
      try { sessionStorage.setItem('phalanx-host', id); } catch {}
      api.id = id;
      api.padUrl = new URL('pad.html#' + id, location.href).href;
      retryWait = 1000;
      if (!api.linked) onStatus('waiting'); // 中継につなぎ直しただけなら、スマホとのつながりはそのまま
    });
    peer.on('connection', c => {
      // つなげるのは1台だけ。新しいスマホが来たら古いほうを切る
      if (conn) conn.close();
      conn = c; lastSeq = -1; lastSeen = performance.now();
      c.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (c === conn) lastSeen = performance.now();
        if (msg.t === 'hello') {
          if (msg.v !== PROTOCOL) { c.close(); return; }
          api.linked = true; onStatus('linked');
        } else if (msg.t === 'thrust' && api.linked) {
          if (typeof msg.seq !== 'number' || msg.seq === lastSeq) return; // 同じ合図は1回だけ
          lastSeq = msg.seq; onThrust();
        } else if (msg.t === 'ping') {
          c.send({ t: 'pong', t0: msg.t0 });
          if (typeof msg.rtt === 'number') { api.rtt = msg.rtt; onRtt(msg.rtt); }
        }
        // 知らない種類は捨てる
      });
      c.on('close', () => drop(c));
    });
    peer.on('error', err => {
      // 再読み込み直後は前の ID がまだサーバーに残っていることがある。そのときは新しい ID で
      if (err.type === 'unavailable-id') { peer.destroy(); start(randomId()); return; }
      if (err.type === 'peer-unavailable') return; // スマホ側の問題。ホストは待ち続ける
      console.warn('[link]', err.type, err);
      // 中継サーバーとのつながりが切れた。つながっているスマホとの直接のやりとりは続くので、
      // 表示は変えずに裏でつなぎ直す。スマホがいないときだけ ✕ を出す
      if (!api.linked) onStatus('error');
      retrySignaling();
    });
    peer.on('disconnected', retrySignaling);
  }

  let retryTimer = 0, retryWait = 1000;
  function retrySignaling() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      if (peer.destroyed) { start(api.id || randomId()); return; }
      if (peer.disconnected) peer.reconnect();
      retryWait = Math.min(retryWait * 2, 15000);
    }, retryWait);
  }
  let saved = null;
  try { saved = sessionStorage.getItem('phalanx-host'); } catch {}
  start(saved || randomId());
  return api;
}

// ===== コントローラー（スマホ）=====
// onStatus(s): 'connecting'（つなぎ中）| 'linked' | 'error'（10秒以上つながらない。裏でつなぎ直しは続ける）
// onMessage(msg): ホストからのメッセージ
//
// 切れたら 1秒・2秒、そのあとは4秒ごとにつなぎ直す。画面に戻ってきたときはすぐつなぎ直す。
// ホストは2秒ごとの ping に pong を返すので、5秒 pong が来なければ切れたとみなす
export function padLink(hostId, { onStatus = () => {}, onMessage = () => {} } = {}) {
  const GIVE_UP = 10000, TIMEOUT = 5000;
  let peer = null, conn = null, seq = 0, status = '';
  let lastPong = 0, downSince = performance.now(), retryTimer = 0, retryWait = 1000;
  const api = { rtt: null, thrust, get open() { return !!(conn && conn.open); } };

  function set(s) { if (s !== status) { status = s; onStatus(s); } }
  function showDown() { set(performance.now() - downSince > GIVE_UP ? 'error' : 'connecting'); }

  function ensurePeer() {
    if (peer && !peer.destroyed) {
      if (peer.disconnected) peer.reconnect();
      return;
    }
    peer = new Peer();
    peer.on('open', () => connect());
    peer.on('disconnected', () => { if (!api.open) schedule(); });
    peer.on('error', err => {
      // peer-unavailable = ホストがまだいない・閉じた。それ以外は中継サーバーの不調など
      if (err.type !== 'peer-unavailable') console.warn('[link]', err.type, err);
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        try { peer.destroy(); } catch {}
      }
      schedule();
    });
  }

  function connect() {
    if (!peer || peer.destroyed || peer.disconnected || !peer.id) { ensurePeer(); return; }
    if (conn) { const old = conn; conn = null; try { old.close(); } catch {} }
    const c = peer.connect(PREFIX + hostId, { reliable: true, serialization: 'json' });
    conn = c;
    c.on('open', () => {
      if (conn !== c) return;
      retryWait = 1000; lastPong = performance.now();
      c.send({ t: 'hello', v: PROTOCOL });
      set('linked');
      ping();
    });
    c.on('data', msg => {
      if (conn !== c || !msg) return;
      if (msg.t === 'pong') { lastPong = performance.now(); api.rtt = lastPong - msg.t0; }
      onMessage(msg);
    });
    c.on('close', () => lost(c));
    c.on('error', () => lost(c));
    // つなぎ込みが返ってこないこともある
    setTimeout(() => { if (conn === c && !c.open) lost(c); }, 6000);
  }

  function lost(c) {
    if (conn !== c) return;
    conn = null; api.rtt = null;
    try { c.close(); } catch {}
    if (status === 'linked') downSince = performance.now();
    schedule();
  }

  function schedule(now = false) {
    showDown();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      if (api.open) return;
      showDown();
      if (!peer || peer.destroyed || peer.disconnected) ensurePeer(); else connect();
    }, now ? 0 : retryWait);
    if (!now) retryWait = Math.min(retryWait * 2, 4000);
  }

  let pingTimer = 0;
  function ping() {
    clearTimeout(pingTimer);
    if (conn && conn.open) {
      if (performance.now() - lastPong > TIMEOUT) { lost(conn); return; }
      conn.send({ t: 'ping', t0: performance.now(), rtt: api.rtt });
    }
    pingTimer = setTimeout(ping, 2000);
  }

  // 画面に戻ってきたら、待たずにつなぎ直す（スリープ明けなど）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // 裏にいる間は ping が止まっているので、3秒だけ待って返事を見る
    if (api.open) { lastPong = Math.max(lastPong, performance.now() - (TIMEOUT - 3000)); ping(); return; }
    retryWait = 1000; schedule(true);
  });
  setInterval(() => { if (!api.open) showDown(); }, 1000);

  function thrust() {
    if (!conn || !conn.open) return false;
    conn.send({ t: 'thrust', seq: ++seq });
    return true;
  }

  set('connecting');
  ensurePeer();
  return api;
}
