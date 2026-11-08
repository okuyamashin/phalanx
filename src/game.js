// ゲームのルールだけを持つモジュール（描画しない）。
// 2D・3D・スマホ操作など、見た目や入力が変わっても同じルールを使えるようにする。

export const CFG = {
  cols: 11,
  reserves: 40,          // 自軍の予備兵
  enemyStartDepth: 3,    // 敵の各列の初期の後列数
  enemyMaxDepth: 9,
  lineStart: 340, lineWin: 120, lineLose: 575, // 押し合いの位置（大きいほど押されている）
  thrustHitAt: 0.14, thrustEnd: 0.8,           // 突きの当たり判定時刻と、無防備が終わる時刻
  counterChance: 0.25,   // 守っている敵に突いたとき反撃される確率
  gapExposeChance: 0.5,  // 右隣が空いているとき、守っていても倒される確率
  ourRefill: 0.7, enemyRefill: 0.5,
  pushPerEnemy: 0.32, pushBase: 12, pushPerKill: 3.5, pushPerBlock: 1.2,
  enemy: { guardMin: 1.1, guardMax: 3.6, windup: 0.6, strike: 0.2, recover: 0.75 },
  spawnStart: 1.3, spawnMin: 0.55, spawnRamp: 0.012,
};

const rand = (a, b) => a + Math.random() * (b - a);

// emit(type, ...args) で演出側に出来事を知らせる
//   'thrust' / 'blocked'(i) / 'clash'(i) / 'ourDeath'(i, why) / 'enemyDeath'(i)
//   'ourRefill'(i) / 'enemyRefill'(i) / 'end'(result, why)
export function createGame(emit = () => {}) {
  let S;

  function newEnemy() {
    return { alive: true, refill: 0, state: 'guard', st: rand(CFG.enemy.guardMin, CFG.enemy.guardMax) };
  }

  function reset() {
    S = {
      phase: 'title', t: 0,
      line: CFG.lineStart,
      reserves: CFG.reserves,
      thrustT: -1, resolvedThrust: false,
      ours: [], enemies: [], depth: [],
      spawnTimer: CFG.spawnStart, spawnInt: CFG.spawnStart,
      pending: [],
      kills: 0, lost: 0, thrusts: 0, why: '', endT: 0,
    };
    for (let i = 0; i < CFG.cols; i++) {
      S.ours.push({ alive: true, refill: 0 });
      S.enemies.push(newEnemy());
      S.depth.push(CFG.enemyStartDepth);
    }
    game.S = S;
  }

  const exposed = () => S.thrustT >= 0 && S.thrustT < CFG.thrustEnd;
  const enemyTotal = () => S.enemies.filter(e => e.alive).length + S.depth.reduce((a, b) => a + b, 0);

  // 入力：突く。タイトル・終了画面では開始/再開になる
  function thrust() {
    if (S.phase === 'title') { S.phase = 'play'; emit('start'); return; }
    if (S.phase !== 'play') { reset(); S.phase = 'play'; emit('start'); return; }
    if (S.thrustT >= 0) return;
    S.thrustT = 0; S.resolvedThrust = false; S.thrusts++;
    emit('thrust');
  }

  function killOurs(i, why) {
    const o = S.ours[i]; if (!o.alive) return;
    o.alive = false; o.refill = CFG.ourRefill; S.lost++;
    emit('ourDeath', i, why);
  }
  function killEnemy(i) {
    const e = S.enemies[i]; if (!e.alive) return;
    e.alive = false; e.refill = CFG.enemyRefill; S.kills++;
    S.line -= CFG.pushPerKill;
    emit('enemyDeath', i);
  }

  function resolveThrust() {
    for (let i = 0; i < CFG.cols; i++) {
      const o = S.ours[i], e = S.enemies[i];
      if (!o.alive || !e.alive) continue;
      if (e.state === 'guard') {
        emit('blocked', i);
        if (Math.random() < CFG.counterChance) S.pending.push({ at: S.t + 0.12, fn: () => { if (exposed()) killOurs(i, '反撃'); } });
      } else if (e.state === 'strike') {
        killEnemy(i);
        if (Math.random() < 0.5) killOurs(i, '相打ち');
      } else {
        killEnemy(i); // 構え中・戻り中はスキ
      }
    }
    // 突かれた敵は警戒して盾を固める（連打は通じない）
    for (const e of S.enemies) {
      if (e.alive && e.state !== 'strike' && e.state !== 'windup') { e.state = 'guard'; e.st = Math.max(e.st, rand(0.8, 2.2)); }
    }
  }

  function enemyStrike(i) {
    const o = S.ours[i];
    if (!o.alive) { S.line += CFG.pushPerBlock * 2; return; } // 穴に入り込まれる
    if (exposed()) { killOurs(i, '突かれた'); return; }
    const rightGap = i < CFG.cols - 1 && !S.ours[i + 1].alive;
    if (rightGap && Math.random() < CFG.gapExposeChance) { killOurs(i, '右が空いた'); return; }
    emit('clash', i);
    S.line += CFG.pushPerBlock;
  }

  function end(r, why = '') { S.phase = r; S.why = why; S.endT = S.t; emit('end', r, why); }

  function update(dt) {
    S.t += dt;
    if (S.phase !== 'play') return;

    S.pending = S.pending.filter(p => (S.t >= p.at ? (p.fn(), false) : true));

    if (S.thrustT >= 0) {
      S.thrustT += dt;
      if (!S.resolvedThrust && S.thrustT >= CFG.thrustHitAt) { S.resolvedThrust = true; resolveThrust(); }
      if (S.thrustT >= CFG.thrustEnd) S.thrustT = -1;
    }

    S.ours.forEach((o, i) => {
      if (!o.alive && S.reserves > 0) {
        o.refill -= dt;
        if (o.refill <= 0) { o.alive = true; S.reserves--; emit('ourRefill', i); }
      }
    });

    const E = CFG.enemy;
    for (let i = 0; i < CFG.cols; i++) {
      const e = S.enemies[i];
      if (!e.alive) {
        if (S.depth[i] > 0) {
          e.refill -= dt;
          if (e.refill <= 0) { Object.assign(e, newEnemy()); S.depth[i]--; emit('enemyRefill', i); }
        }
        continue;
      }
      e.st -= dt;
      if (e.st > 0) continue;
      if (e.state === 'guard') { e.state = 'windup'; e.st = E.windup * rand(0.85, 1.15); }
      else if (e.state === 'windup') { e.state = 'strike'; e.st = E.strike; enemyStrike(i); }
      else if (e.state === 'strike') { e.state = 'recover'; e.st = E.recover * rand(0.85, 1.15); }
      else { e.state = 'guard'; e.st = rand(E.guardMin, E.guardMax); }
    }

    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      S.spawnInt = Math.max(CFG.spawnMin, S.spawnInt - CFG.spawnRamp * S.spawnInt * 3);
      S.spawnTimer = S.spawnInt;
      const i = Math.floor(Math.random() * CFG.cols);
      if (S.depth[i] < CFG.enemyMaxDepth) S.depth[i]++;
    }

    const total = enemyTotal();
    S.line += Math.max(-4, total * CFG.pushPerEnemy - CFG.pushBase) * dt;

    if (S.line <= CFG.lineWin || total === 0) end('win');
    else if (S.line >= CFG.lineLose) end('lose', '押し切られた');
    else if (S.reserves === 0 && S.ours.every(o => !o.alive)) end('lose', '隊が尽きた');
  }

  const game = { S: null, reset, thrust, update, exposed, enemyTotal };
  reset();
  return game;
}
