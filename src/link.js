// スマホ（コントローラー）とパソコン（ホスト）を WebRTC でつなぐ部品。
// PeerJS（グローバルの Peer）を使う。最初のつなぎ込みだけ PeerJS Cloud を通り、
// つながったあとは端末どうしで直接やりとりする。
//
// メッセージ（JSON）
//   スマホ → ホスト : {t:'hello', v}  {t:'thrust', seq}  {t:'ping', t0}
//   ホスト → スマホ : {t:'pong', t0}  {t:'state', ...}

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
export function hostLink({ onThrust = () => {}, onStatus = () => {} } = {}) {
  let peer = null, conn = null, lastSeq = -1;
  const api = { id: null, padUrl: null, linked: false, send };

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  function start(id) {
    peer = new Peer(PREFIX + id);
    onStatus('connecting');
    peer.on('open', () => {
      try { sessionStorage.setItem('phalanx-host', id); } catch {}
      api.id = id;
      api.padUrl = new URL('pad.html#' + id, location.href).href;
      onStatus('waiting');
    });
    peer.on('connection', c => {
      // つなげるのは1台だけ。新しいスマホが来たら古いほうを切る
      if (conn) conn.close();
      conn = c; lastSeq = -1;
      c.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello') {
          if (msg.v !== PROTOCOL) { c.close(); return; }
          api.linked = true; onStatus('linked');
        } else if (msg.t === 'thrust' && api.linked) {
          if (typeof msg.seq !== 'number' || msg.seq === lastSeq) return; // 同じ合図は1回だけ
          lastSeq = msg.seq; onThrust();
        } else if (msg.t === 'ping') {
          c.send({ t: 'pong', t0: msg.t0 });
        }
        // 知らない種類は捨てる
      });
      c.on('close', () => {
        if (conn !== c) return;
        conn = null; api.linked = false; onStatus('waiting');
      });
    });
    peer.on('error', err => {
      // 再読み込み直後は前の ID がまだサーバーに残っていることがある。そのときは新しい ID で
      if (err.type === 'unavailable-id') { peer.destroy(); start(randomId()); return; }
      if (err.type === 'peer-unavailable') return; // スマホ側の問題。ホストは待ち続ける
      console.warn('[link]', err.type, err);
      onStatus('error');
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  let saved = null;
  try { saved = sessionStorage.getItem('phalanx-host'); } catch {}
  start(saved || randomId());
  return api;
}

// ===== コントローラー（スマホ）=====
// onStatus(s, info): 'connecting' | 'linked' | 'closed' | 'error'
// onMessage(msg)   : ホストからのメッセージ
export function padLink(hostId, { onStatus = () => {}, onMessage = () => {} } = {}) {
  let conn = null, seq = 0;
  const api = { rtt: null, thrust, get open() { return !!(conn && conn.open); } };
  const peer = new Peer();
  onStatus('connecting');

  peer.on('open', () => {
    conn = peer.connect(PREFIX + hostId, { reliable: true, serialization: 'json' });
    conn.on('open', () => {
      conn.send({ t: 'hello', v: PROTOCOL });
      onStatus('linked');
      ping();
    });
    conn.on('data', msg => {
      if (msg && msg.t === 'pong') { api.rtt = performance.now() - msg.t0; onMessage(msg); return; }
      onMessage(msg);
    });
    conn.on('close', () => onStatus('closed'));
  });
  peer.on('error', err => { console.warn('[link]', err.type, err); onStatus('error', err.type); });

  let pingTimer = 0;
  function ping() {
    clearTimeout(pingTimer);
    if (conn && conn.open) conn.send({ t: 'ping', t0: performance.now() });
    pingTimer = setTimeout(ping, 2000);
  }
  function thrust() {
    if (!conn || !conn.open) return false;
    conn.send({ t: 'thrust', seq: ++seq });
    return true;
  }
  return api;
}
