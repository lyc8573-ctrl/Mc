const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool, types } = require('pg');
types.setTypeParser(20, Number); types.setTypeParser(1700, Number);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL ? { rejectUnauthorized: false } : false });
const q = async (s, a) => (await pool.query(s, a)).rows;
const GAME = fs.readFileSync(path.join(__dirname, 'index.html')), ADMIN = fs.readFileSync(path.join(__dirname, 'admin.html'));
const vm = require('vm');
const ECON = (() => {
  const t = GAME.toString('utf8'), b = t.slice(t.lastIndexOf('<script>') + 8);
  const pre = b.slice(0, b.indexOf('let S,tab=')), en = b.match(/const EN=\[[\s\S]*?\],RN=\[[^\]]*\];/)[0], em = b.match(/const enMul=[^\n]*/)[0];
  const ctx = vm.createContext({}); vm.runInContext(pre + en + em + ';this.E={D,G,PK,TW,RUN,EN,enMul,PR}', ctx); return ctx.E;
})();
const RANK = o => (o && o.eter ? 3 : o && o.prem ? 2 : o && o.vip ? 1 : 0), UCAP = 250000, UREF = 60000;
function maxPrice(c, tf) {
  try { const d = ECON.D[c.k]; if (!d) return 0; const sb = c.ser == 1 ? 10 : c.ser <= 10 ? 3 : c.ser <= c.max * .01 ? 1.5 : 1, en = c.en && c.en.length ? ECON.enMul(c) : 4.6;
    return Math.floor(d[3] * 1.8 * (c.grade ? ECON.G[c.grade] : ECON.G[10]) * (c.foil ? 2.5 : 1) * sb * en * tf) + 1; } catch { return 0; }
}
const pmax = r => { const rows = ECON.TW.map(w => w[r] / w.reduce((a, b) => a + b, 0)); const m = Math.max(...rows) * (r === 5 ? 12 : r >= 3 ? 3 : 1); return Math.max(m, r === 4 ? .003 * 3 : 0); };
function guard(P, N, x) { // 回傳 {bad:原因} 或 {ok:1, ub:新的未見額度}
  if (!N || typeof N.em !== 'number' || !isFinite(N.em) || N.em < 0 || N.em > 1e13 || !Array.isArray(N.cards) || typeof N.id !== 'number') return { bad: '存檔格式錯誤' };
  const dt = Math.min(Math.max(x.dt, 5), 1800), rP = RANK(P), allowR = x.adm ? 3 : rP, rN = RANK(N), tf = x.adm ? 1.5 : allowR === 3 ? 1.1 : .92, mult = x.adm ? 100 : allowR === 3 ? 10 : 1;
  if (!(N.id >= P.id)) return { bad: '卡片編號倒退' };
  const ids = a => new Set((a || []).map(c => c.id)), known = ids(P.cards), nIds = ids(N.cards);
  (P.inv || []).forEach(k => (k.cs || []).forEach(c => known.add(c.id))); (P.esc || []).forEach(e => (e.cs || []).forEach(c => known.add(c.id)));
  let sales = 0; P.cards.forEach(c => { if (!nIds.has(c.id)) sales += maxPrice(c, tf); });
  const nInv = new Set((N.inv || []).map(k => k.id)); (P.inv || []).forEach(k => { if (!nInv.has(k.id)) { sales += Math.floor((k.paid || 0) * .85) + 1; (k.cs || []).forEach(c => { sales += maxPrice(c, tf); }); } });
  const mine = dt * 10 * 8 * mult, base = mine + sales; // 挖礦上限：每秒 10 下、每下最多 8
  // 新卡檢查
  const seen = new Set(); let newCards = [], bad = null;
  N.cards.forEach(c => { if (seen.has(c.id)) bad = '卡片編號重複'; seen.add(c.id); if (!known.has(c.id)) { newCards.push(c); if (!(c.id >= P.id && c.id < N.id)) bad = '憑空出現的卡片'; if (!ECON.D[c.k]) bad = '不存在的卡片'; } });
  if (bad) return { bad };
  // 已存在的卡片：稀有度、序號、閃卡不可改；鑑定分只能從 0 變成 1~10；附魔只能從無變有
  const enOk = en => Array.isArray(en) && en.length <= 3 && en.every((e, i) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < ECON.EN.length && Number.isInteger(e[1]) && e[1] >= 1 && e[1] <= 5 && en.findIndex(y => y[0] === e[0]) === i);
  const shapeOk = c => { const d = ECON.D[c.k]; if (!d || !Number.isInteger(c.id)) return false; const m = ECON.RUN[d[2]], g = c.grade || 0; return Number.isInteger(c.ser) && c.ser >= 1 && c.ser <= m && c.max === m && Number.isInteger(g) && g >= 0 && g <= 10 && enOk(c.en || []); };
  const old = new Map(); P.cards.forEach(c => old.set(c.id, c)); (P.inv || []).forEach(k => (k.cs || []).forEach(c => old.set(c.id, c))); (P.esc || []).forEach(e => (e.cs || []).forEach(c => old.set(c.id, c)));
  const all = N.cards.slice(); (N.inv || []).forEach(k => (k.cs || []).forEach(c => all.push(c))); (N.esc || []).forEach(e => (e.cs || []).forEach(c => all.push(c)));
  let newGraded = 0;
  all.forEach(c => {
    if (!c || !ECON.D[c.k]) { bad = '不存在的卡片'; return; }
    const o = old.get(c.id);
    if (!o) { if (!shapeOk(c)) bad = '卡片資料異常'; if (c.grade) newGraded++; return; }
    if (o.k !== c.k || o.ser !== c.ser || !!o.foil !== !!c.foil || o.max !== c.max) bad = '卡片內容被竄改';
    const og = o.grade || 0, ng = c.grade || 0; if (ng !== og && !(og === 0 && Number.isInteger(ng) && ng >= 1 && ng <= 10)) bad = '卡片鑑定分被竄改';
    const oe = JSON.stringify(o.en || []), ne = JSON.stringify(c.en || []); if (oe !== ne && !(oe === '[]' && enOk(c.en || []))) bad = '卡片附魔被竄改';
  });
  if (newGraded > 10) bad = '憑空出現已鑑定的卡片';
  if (bad) return { bad };
  const newInv = (N.inv || []).filter(k => k.id >= P.id), created = N.id - P.id, used = newCards.length + newInv.reduce((a, k) => a + 1 + (k.cs || []).length, 0), unseen = Math.max(0, created - used);
  const minCost = 100 * (x.adm ? .1 : allowR === 3 ? .3 : allowR === 2 ? .6 : allowR === 1 ? .8 : 1), packs = Math.ceil(created / 6);
  if (packs > Math.floor((P.em + base) / Math.max(1, minCost)) + 60) return { bad: '卡片數量和綠寶石花費對不上' };
  const nr = [0, 0, 0, 0, 0, 0]; newCards.forEach(c => { nr[ECON.D[c.k][2]]++; });
  const cardsMade = packs * 5, lim5 = Math.ceil(cardsMade * pmax(5) * 2 + packs / 80 * 2) + 3, lim4 = Math.ceil(cardsMade * pmax(4) * 2) + 12;
  if (nr[5] > lim5 || nr[4] > lim4) return { bad: '稀有卡出現的數量超出可能範圍' };
  // 綠寶石檢查
  const ub = Math.min(UCAP, (x.ub == null ? UCAP : x.ub) + UREF / 3600 * dt), delta = N.em - P.em;
  let allow = base, nub = ub;
  if (delta > base) { const need = delta - base, avail = Math.min(unseen * 2500, ub); if (need > avail) return { bad: '綠寶石增加得太快（+' + Math.round(delta) + '）' }; nub = ub - need; allow = delta; }
  // 通行證檢查
  if (rN > allowR) {
    const cost = rN >= 3 && allowR < 3 ? 1e6 : rN >= 2 && allowR < 2 ? 1e5 : 0;
    if (cost) { if (N.em > P.em + Math.max(allow, base) - cost * .9) return { bad: '通行證沒有付款' }; }
    else { const t2 = N.cards.map(c => maxPrice(c, 1)).sort((a, b) => b - a).slice(0, 2); if (t2.length < 2 || t2[0] + t2[1] <= 10000) return { bad: 'VIP 條件不符' }; }
  }
  return { ok: 1, ub: nub };
}
const untov = d => { if (!d.tov || !d.treal || typeof d.treal !== 'object') return d; const c = JSON.parse(JSON.stringify(d)), t = d.treal; c.vip = t.vip ? 1 : 0; c.prem = t.prem ? 1 : 0; c.eter = t.eter ? 1 : 0; delete c.tov; delete c.treal; return c; }; // 全服暫時通行證：存檔和檢查一律用玩家真正的通行證
const freshState = () => ({ em: 500, cards: [], id: 1, pity: 0, dex: [], m: ECON.D.map(() => 1), pm: ECON.D.map(() => 1), opened: 0, log: [], inv: [], pp: {}, auto: { r: [0, 0, 0, 0, 0, 0], f: 1 }, esc: [], seen: {}, rep: [] });
const BANPAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#000;color:#fff;font:20px sans-serif;text-align:center;padding:80px 20px"><h1>🚫</h1><p>你的帳號或裝置已被停權</p>';
const send = (res, s, o, h) => { res.writeHead(s, Object.assign({ 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' }, h)); res.end(JSON.stringify(o)); };
const body = (req, max = 1000000) => new Promise((ok, no) => { let n = 0; const a = []; req.on('data', c => { n += c.length; if (n > max) { no(new Error('too big')); req.destroy(); } else a.push(c); }); req.on('end', () => ok(Buffer.concat(a).toString())); req.on('error', no); });
const ipOf = req => String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 64);
const cookie = (req, n) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
const sha = s => crypto.createHash('sha256').update(s).digest();
const log = (act, pid, detail) => q('INSERT INTO logs(ts,act,pid,detail) VALUES($1,$2,$3,$4)', [Date.now(), act, pid || '', String(detail || '').slice(0, 200)]).catch(() => {});
let ready;
const init = () => ready || (ready = (async () => {
  await q('CREATE TABLE IF NOT EXISTS players(pid TEXT PRIMARY KEY,name TEXT,data TEXT,em BIGINT,cards BIGINT,opened BIGINT,tier TEXT,banned INTEGER DEFAULT 0,gift BIGINT DEFAULT 0,created BIGINT,updated BIGINT)');
  for (const c of ['ip TEXT', 'fp TEXT', 'ua TEXT', 'note TEXT', 'ban_reason TEXT', 'banned_at BIGINT', "cmds TEXT DEFAULT '[]'", 'hits BIGINT DEFAULT 0', 'adm INTEGER DEFAULT 0', 'tok BIGINT', 'ub BIGINT', 'strikes INTEGER DEFAULT 0', 'rej TEXT', 'trust INTEGER DEFAULT 0']) await q('ALTER TABLE players ADD COLUMN IF NOT EXISTS ' + c).catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS bans(kind TEXT,val TEXT,pid TEXT,reason TEXT,created BIGINT,PRIMARY KEY(kind,val))');
  await q('CREATE TABLE IF NOT EXISTS logs(ts BIGINT,act TEXT,pid TEXT,detail TEXT)');
  await q('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT)');
  await q('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY,em BIGINT DEFAULT 0,tier TEXT DEFAULT \'\',max_uses INTEGER DEFAULT 0,used INTEGER DEFAULT 0,expires BIGINT DEFAULT 0,enabled INTEGER DEFAULT 1,note TEXT,created BIGINT)');
  await q('ALTER TABLE codes ADD COLUMN IF NOT EXISTS cards TEXT').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS redeems(code TEXT,pid TEXT,ts BIGINT,PRIMARY KEY(code,pid))');
})().catch(e => { ready = null; throw e; }));
const banHit = async (pid, gid, ip, fp) => (await q("SELECT kind,pid FROM bans WHERE (kind='pid' AND val IN ($1,$2)) OR (kind='ip' AND val=$3) OR (kind='fp' AND val=$4) LIMIT 1", [pid || '-', gid || '-', ip || '-', fp || '-']))[0] || null;
const UPSERT = 'INSERT INTO players(pid,name,data,em,cards,opened,tier,ip,fp,ua,created,updated,tok,ub) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11,$12) ON CONFLICT(pid) DO UPDATE SET name=EXCLUDED.name,data=EXCLUDED.data,em=EXCLUDED.em,cards=EXCLUDED.cards,opened=EXCLUDED.opened,tier=CASE WHEN players.adm=1 THEN \'管理員\' ELSE EXCLUDED.tier END,ip=EXCLUDED.ip,fp=CASE WHEN EXCLUDED.fp<>\'\' THEN EXCLUDED.fp ELSE players.fp END,ua=EXCLUDED.ua,updated=EXCLUDED.updated,tok=EXCLUDED.tok,ub=EXCLUDED.ub,hits=COALESCE(players.hits,0)+1';
async function pushCmd(pid, c) {
  const r = (await q('SELECT cmds FROM players WHERE pid=$1', [pid]))[0]; if (!r) return;
  let a = []; try { a = JSON.parse(r.cmds || '[]'); } catch {}
  a.push(c); await q('UPDATE players SET cmds=$1 WHERE pid=$2', [JSON.stringify(a.slice(-50)), pid]);
}
const FLAGS = { none: { vip: 0, prem: 0, eter: 0 }, vip: { vip: 1, prem: 0, eter: 0 }, prem: { vip: 1, prem: 1, eter: 0 }, eter: { vip: 1, prem: 1, eter: 1 } };
const TIERNAME = o => o.eter ? '永恆' : o.prem ? '至尊' : o.vip ? 'VIP' : '普通';
function mkGrantCard(t, P) {
  const r = ECON.D[t.k][2], max = ECON.RUN[r], ser = t.ser > 0 ? Math.min(max, t.ser) : 1 + Math.floor(Math.random() * max);
  return { id: (P.gid = (P.gid || 1e9) + 1), k: t.k, foil: !!t.foil, ser, max, grade: t.grade || 0, pend: 0, pd: 0, en: t.en || [], t: Date.now() };
}
function cleanTpl(a) { // 驗證卡片範本（兌換碼 / 後台發卡共用）
  const out = []; let total = 0;
  for (const t of Array.isArray(a) ? a : []) {
    const k = Math.floor(Number(t.k)); if (!ECON.D[k]) continue;
    const n = Math.min(50, Math.max(1, Math.floor(Number(t.n)) || 1)); total += n; if (total > 100) break;
    const max = ECON.RUN[ECON.D[k][2]], ser = Math.min(max, Math.max(0, Math.floor(Number(t.ser)) || 0)), grade = Math.min(10, Math.max(0, Math.floor(Number(t.grade)) || 0));
    const en = []; for (const e of (Array.isArray(t.en) ? t.en : []).slice(0, 3)) { const i = Math.floor(Number(e[0])), l = Math.min(5, Math.max(1, Math.floor(Number(e[1])) || 1)); if (i >= 0 && i < ECON.EN.length && !en.some(x => x[0] === i)) en.push([i, l]); }
    out.push({ k, n, foil: t.foil ? 1 : 0, ser, grade, en });
  }
  return out;
}
const cardCount = a => a.reduce((x, t) => x + t.n, 0);
// 把已發出的獎勵同步寫進伺服器存的存檔，這樣玩家領到之前被還原也不會弄丟
function applyServer(P, c) {
  if (c.t === 'em') P.em = Math.max(0, Math.floor(P.em + c.n));
  else if (c.t === 'emset') P.em = Math.max(0, Math.floor(c.n));
  else if (c.t === 'tier') { const f = FLAGS[c.v]; if (!f) return false; const cur = P.adm ? (P.admBase || {}) : P; if (c.up && RANK(cur) >= RANK(f)) return false; if (P.adm) P.admBase = f; else { P.vip = f.vip; P.prem = f.prem; P.eter = f.eter; } if (f.vip) { P.pp = P.pp || {}; P.pc = P.pc || 0; } }
  else if (c.t === 'cards') { c.cs = []; for (const t of c.tpl || []) for (let i = 0; i < t.n; i++) { const card = mkGrantCard(t, P); P.cards.push(card); c.cs.push(card); P.dex = P.dex || []; P.dex[t.k] = 1; } c.gid = P.gid; delete c.tpl; }
  else if (c.t === 'state') { return 'state'; }
  else return false;
  return true;
}
async function storeState(pid, P) {
  await q('UPDATE players SET data=$1,em=$2,cards=$3,tier=CASE WHEN adm=1 THEN $4 ELSE $5 END WHERE pid=$6', [JSON.stringify(P), Math.floor(P.em) || 0, P.cards.length, '管理員', TIERNAME(P), pid]);
}
async function save(req, res) {
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad request' }); }
  const pid = String(b.pid || '');
  if (!/^[\w-]{8,64}$/.test(pid) || !b.data || typeof b.data !== 'object') return send(res, 400, { error: 'bad request' });
  const d = untov(b.data), now = Date.now(), name = String(b.name || '未命名').slice(0, 20);
  const em = Math.floor(Number(d.em)) || 0, cards = Array.isArray(d.cards) ? d.cards.length : 0, opened = Math.floor(Number(d.opened)) || 0;
  const tier = d.eter ? '永恆' : d.prem ? '至尊' : d.vip ? 'VIP' : '普通';
  const fp = b.fp ? sha(String(b.fp).slice(0, 600)).toString('hex').slice(0, 16) : '';
  const ip = ipOf(req), gid = cookie(req, 'gid'), ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const hit = await banHit(pid, gid, ip, fp);
  const prev = (await q('SELECT data,tok,updated,adm,trust,ub,banned FROM players WHERE pid=$1', [pid]))[0];
  let P = null; if (prev && prev.data) { try { P = JSON.parse(prev.data); } catch {} }
  let verdict = { ok: 1, ub: UCAP };
  if (!(prev && (prev.trust || prev.banned))) {
    if (P) verdict = guard(P, d, { dt: (now - (prev.tok || prev.updated || now)) / 1000, adm: prev.adm, ub: prev.ub });
    else verdict = guard(freshState(), d, { dt: 60, adm: prev ? prev.adm : 0, ub: 5000 }); // 首次同步：必須和全新存檔差不多，否則先擋下來等管理員確認
  }
  let base = d, fixState = null;
  if (verdict.bad) {
    if (P) { fixState = JSON.parse(JSON.stringify(P)); base = P; }
    else { base = freshState(); fixState = JSON.parse(JSON.stringify(base)); await q(UPSERT, [pid, name, JSON.stringify(base), 500, 0, 0, '普通', ip, fp, ua, now, 5000]); }
    await q('UPDATE players SET name=$1,ip=$2,ua=$3,updated=$4,hits=COALESCE(hits,0)+1,strikes=COALESCE(strikes,0)+1,rej=$5 WHERE pid=$6', [name, ip, ua, now, JSON.stringify(d), pid]);
    log('cheat', pid, name + ' 數值異常，已還原：' + verdict.bad);
  } else {
    await q(UPSERT, [pid, name, JSON.stringify(d), em, cards, opened, tier, ip, fp, ua, now, Math.floor(verdict.ub)]);
    if (!P && (em > 2e6 || cards > 500)) log('sus', pid, name + ' 首次同步數值很高（💚' + em + '、卡 ' + cards + '）');
  }
  let r = (await q('SELECT banned,ban_reason,cmds,adm FROM players WHERE pid=$1', [pid]))[0];
  if (hit && !r.banned) { // 封禁規避：換帳號/清資料但 cookie、IP 或裝置碼仍符合
    const why = '封禁規避（符合 ' + hit.kind + '）';
    await q("INSERT INTO bans(kind,val,pid,reason,created) VALUES('pid',$1,$2,$3,$4) ON CONFLICT(kind,val) DO NOTHING", [pid, hit.pid || pid, why, now]);
    await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [why, now, pid]);
    log('evade', pid, why + ' ' + name); r = { banned: 1, ban_reason: why };
  }
  const h = gid ? {} : { 'set-cookie': 'gid=' + pid + '; Max-Age=315360000; Path=/; HttpOnly; SameSite=Lax; Secure' };
  if (d.adm && !r.adm && !r.banned) log('cheat', pid, name + ' 本機存檔宣稱有特別通行證，但後台沒發放');
  if (r.banned) return send(res, 200, { ok: 1, banned: true, reason: r.ban_reason || '' }, h);
  let cmds = []; try { cmds = JSON.parse(r.cmds || '[]'); } catch {}
  if (cmds.length) {
    const got = await q('UPDATE players SET cmds=$1 WHERE pid=$2 AND cmds=$3 RETURNING pid', ['[]', pid, r.cmds]);
    if (!got.length) cmds = [];
    else if (base) {
      let dirty = false, reset = false;
      if (P && base !== P && (P.gid || 0) > (base.gid || 0)) base.gid = P.gid; // 發卡編號不能因為客戶端沒帶而重複
      for (const c of cmds) { if (c.t === 'reset') { reset = true; continue; } const x = applyServer(base, c); if (x === 'state') { try { Object.keys(base).forEach(k => delete base[k]); Object.assign(base, JSON.parse(c.s)); } catch {} dirty = true; } else dirty = x || dirty; }
      if (reset) await q("UPDATE players SET data='',tok=NULL,strikes=0,rej=NULL WHERE pid=$1", [pid]); else if (dirty) await storeState(pid, base);
    }
  }
  const kvs = {}; for (const x of await q("SELECT k,v FROM kv WHERE k IN ('ann','maint','tierov')")) kvs[x.k] = x.v;
  let tov = null; if (kvs.tierov) { try { const o = JSON.parse(kvs.tierov); if (!o.until || o.until > now) tov = { id: o.id, v: o.v }; } catch {} }
  send(res, 200, { ok: 1, banned: false, adm: r.adm ? 1 : 0, fix: fixState, why: fixState ? verdict.bad : '', cmds, ann: kvs.ann ? JSON.parse(kvs.ann) : null, maint: kvs.maint || '', tov }, h);
}
const rfail = new Map(), TN = { vip: 'VIP', prem: '至尊', eter: '永恆' };
async function redeem(req, res) {
  let b; try { b = JSON.parse(await body(req, 5000)); } catch { return send(res, 400, { error: '格式錯誤' }); }
  const pid = String(b.pid || ''), code = String(b.code || '').trim().toUpperCase().slice(0, 32), now = Date.now(), ip = ipOf(req);
  const f = rfail.get(ip); if (f && f.n >= 8 && now - f.t < 600000) return send(res, 429, { error: '嘗試次數太多，請 10 分鐘後再試' });
  const miss = m => { const x = f && now - f.t < 600000 ? f : { n: 0 }; x.n++; x.t = now; rfail.set(ip, x); return send(res, 200, { error: m }); };
  const pl = (await q('SELECT banned FROM players WHERE pid=$1', [pid]))[0];
  if (!pl) return send(res, 200, { error: '請先等遊戲同步完成（約 15 秒）再兌換' });
  if (pl.banned) return send(res, 200, { error: '帳號已被停權' });
  if (!code) return send(res, 200, { error: '請輸入兌換碼' });
  const c = (await q('SELECT * FROM codes WHERE code=$1', [code]))[0];
  if (!c) return miss('兌換碼不存在');
  if (!c.enabled) return send(res, 200, { error: '這組兌換碼已停用' });
  if (c.expires && c.expires < now) return send(res, 200, { error: '這組兌換碼已過期' });
  if (c.max_uses && c.used >= c.max_uses) return send(res, 200, { error: '這組兌換碼已被領完' });
  const ins = await q('INSERT INTO redeems(code,pid,ts) VALUES($1,$2,$3) ON CONFLICT(code,pid) DO NOTHING RETURNING code', [code, pid, now]);
  if (!ins.length) return send(res, 200, { error: '你已經兌換過這組代碼了' });
  const upd = await q('UPDATE codes SET used=used+1 WHERE code=$1 AND enabled=1 AND (max_uses=0 OR used<max_uses) AND (expires=0 OR expires>$2) RETURNING em,tier', [code, now]);
  if (!upd.length) { await q('DELETE FROM redeems WHERE code=$1 AND pid=$2', [code, pid]); return send(res, 200, { error: '這組兌換碼剛剛被領完了' }); }
  const parts = [];
  if (upd[0].em) { await pushCmd(pid, { t: 'em', n: upd[0].em }); parts.push('💚' + upd[0].em); }
  if (upd[0].tier) { await pushCmd(pid, { t: 'tier', v: upd[0].tier, up: 1 }); parts.push((TN[upd[0].tier] || '') + '通行證'); }
  let tpl = []; try { tpl = cleanTpl(JSON.parse(c.cards || '[]')); } catch {}
  if (tpl.length) { await pushCmd(pid, { t: 'cards', tpl }); parts.push('🃏卡片 ×' + cardCount(tpl)); }
  log('redeem', pid, code + ' ' + parts.join(' + '));
  send(res, 200, { ok: 1, desc: parts.join(' + ') });
}
const fails = new Map();
async function isAdmin(req) {
  const w = process.env.ADMIN_PASSWORD; if (!w) return false;
  return crypto.timingSafeEqual(sha(String(req.headers['x-admin'] || '')), sha(w));
}
const SORT = { recent: 'updated DESC', em: 'em DESC', cards: 'cards DESC', opened: 'opened DESC', new: 'created DESC' };
async function admin(req, res, u) {
  try { return await adminInner(req, res, u); } catch (e) { console.error(e); return send(res, 500, { error: 'server error: ' + String(e.message).slice(0, 150) }); }
}
async function adminInner(req, res, u) {
  const ip = ipOf(req), f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 600000) return send(res, 429, { error: 'too many' });
  if (!(await isAdmin(req))) { const x = f && Date.now() - f.t < 600000 ? f : { n: 0 }; x.n++; x.t = Date.now(); fails.set(ip, x); return send(res, 401, { error: 'unauthorized' }); }
  fails.delete(ip);
  const p = u.pathname, now = Date.now();
  if (p === '/api/admin/stats') {
    const r = (await q('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN updated>$1 THEN 1 ELSE 0 END),0) AS online, COALESCE(SUM(CASE WHEN updated>$2 THEN 1 ELSE 0 END),0) AS active24, COALESCE(SUM(CASE WHEN banned=1 THEN 1 ELSE 0 END),0) AS banned, COALESCE(SUM(em),0) AS em, COALESCE(SUM(opened),0) AS opened, COALESCE(SUM(CASE WHEN adm=1 THEN 1 ELSE 0 END),0) AS adm FROM players', [now - 120000, now - 86400000]))[0];
    r.bans = (await q('SELECT COUNT(*) AS n FROM bans'))[0].n; r.codes = (await q('SELECT COUNT(*) AS n FROM codes'))[0].n; return send(res, 200, r);
  }
  if (p === '/api/admin/list') {
    const where = [], a = [], qs = (u.searchParams.get('q') || '').toLowerCase(), fl = u.searchParams.get('f');
    if (qs) { a.push('%' + qs + '%'); const n = '$' + a.length; where.push(`(LOWER(name) LIKE ${n} OR LOWER(pid) LIKE ${n} OR LOWER(COALESCE(ip,'')) LIKE ${n})`); }
    if (fl === 'banned') where.push('banned=1'); else if (fl === 'adm') where.push('adm=1'); else if (fl === 'online') { a.push(now - 120000); where.push('updated>$' + a.length); }
    const rows = await q('SELECT pid,name,em,cards,opened,tier,banned,ip,created,updated,strikes FROM players' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ' + (SORT[u.searchParams.get('s')] || SORT.recent) + ' LIMIT 300', a);
    return send(res, 200, { players: rows });
  }
  if (p === '/api/admin/player') {
    const pl = (await q('SELECT * FROM players WHERE pid=$1', [u.searchParams.get('pid') || '']))[0];
    if (!pl) return send(res, 404, { error: 'not found' });
    const c = [], a = [pl.pid];
    if (pl.fp) c.push('fp=$' + a.push(pl.fp)); if (pl.ip) c.push('ip=$' + a.push(pl.ip));
    const related = c.length ? await q('SELECT pid,name,banned FROM players WHERE pid<>$1 AND (' + c.join(' OR ') + ') LIMIT 20', a) : [];
    const redeems = await q('SELECT code,ts FROM redeems WHERE pid=$1 ORDER BY ts DESC LIMIT 20', [pl.pid]);
    return send(res, 200, { player: pl, related, redeems });
  }
  if (p === '/api/admin/bans') return send(res, 200, { bans: await q('SELECT b.kind,b.val,b.pid,b.reason,b.created,p.name FROM bans b LEFT JOIN players p ON p.pid=b.pid ORDER BY b.created DESC LIMIT 300') });
  if (p === '/api/admin/cardlist') return send(res, 200, { cards: ECON.D.map((d, k) => ({ k, n: d[0], e: d[1], r: d[2], max: ECON.RUN[d[2]] })), en: ECON.EN.map(e => e[0]) });
  if (p === '/api/admin/codes') return send(res, 200, { codes: await q('SELECT * FROM codes ORDER BY created DESC LIMIT 300') });
  if (p === '/api/admin/codeusers') return send(res, 200, { users: await q('SELECT r.pid,r.ts,p.name FROM redeems r LEFT JOIN players p ON p.pid=r.pid WHERE r.code=$1 ORDER BY r.ts DESC LIMIT 200', [u.searchParams.get('code') || '']) });
  if (p === '/api/admin/logs') return send(res, 200, { logs: await q('SELECT ts,act,pid,detail FROM logs ORDER BY ts DESC LIMIT 100') });
  if (p === '/api/admin/tierov' && req.method !== 'POST') { const r = (await q("SELECT v FROM kv WHERE k='tierov'"))[0]; let o = null; try { o = r && JSON.parse(r.v); } catch {} if (o && o.until && o.until <= now) o = null; return send(res, 200, { tierov: o }); }
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
  if (p === '/api/admin/announce') {
    const t = String(b.text || '').slice(0, 500);
    if (t) await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['ann', JSON.stringify({ id: now, text: t })]); else await q("DELETE FROM kv WHERE k='ann'");
    log('announce', '', t || '(清除)'); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/tierov') { // 全服暫時通行證：v = none/vip/prem/eter，空字串 = 關閉；hours 0 = 手動關閉前一直有效
    const v = String(b.v || '');
    if (!v) await q("DELETE FROM kv WHERE k='tierov'");
    else { if (!FLAGS[v]) return send(res, 400, { error: 'bad' }); const h = Number(b.hours) > 0 ? Math.min(720, Number(b.hours)) : 0; await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['tierov', JSON.stringify({ id: now, v, until: h ? Math.floor(now + h * 3600000) : 0 })]); }
    log('tierov', '', v ? v + ' ' + (b.hours || 0) + 'h' : '(關閉)'); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/maint') {
    const t = String(b.text || '').slice(0, 200);
    if (t) await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['maint', t]); else await q("DELETE FROM kv WHERE k='maint'");
    log('maint', '', t || '(關閉)'); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/broadcast') {
    const c = b.cmd || {};
    if (c.t === 'em') { c.n = Math.floor(Number(c.n)); if (!c.n || Math.abs(c.n) > 1e9) return send(res, 400, { error: 'bad n' }); }
    else if (c.t === 'msg') c.s = String(c.s || '').slice(0, 300);
    else if (c.t === 'cards') { const tpl = cleanTpl(c.tpl); if (!tpl.length) return send(res, 400, { error: '沒有有效的卡片' }); c.tpl = tpl; }
    else return send(res, 400, { error: 'bad cmd' });
    const rows = await q('SELECT pid FROM players WHERE banned=0 LIMIT 2000');
    for (const r of rows) await pushCmd(r.pid, c);
    log('broadcast', '', JSON.stringify(c)); return send(res, 200, { ok: 1, n: rows.length });
  }
  if (p !== '/api/admin/act') return send(res, 404, { error: 'not found' });
  const pid = String(b.pid || ''), reason = String(b.reason || '違規').slice(0, 100);
  const add = (kind, val, src) => val && q('INSERT INTO bans(kind,val,pid,reason,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,val) DO UPDATE SET pid=EXCLUDED.pid,reason=EXCLUDED.reason', [kind, val, src, reason, now]);
  if (b.act === 'newcode') {
    let code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (!code) { const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (const x of crypto.randomBytes(10)) code += al[x % al.length]; }
    else if (code.length < 3) return send(res, 400, { error: '代碼至少 3 個字（只能用英文數字 - _）' });
    const em = Math.floor(Number(b.em)) || 0, tier = ['vip', 'prem', 'eter'].includes(b.tier) ? b.tier : '';
    const tpl = cleanTpl(b.cards);
    if (em < 0 || em > 1e9 || (!em && !tier && !tpl.length)) return send(res, 400, { error: '至少要設定綠寶石、通行證或卡片' });
    const max = Math.max(0, Math.floor(Number(b.max)) || 0), exp = Number(b.hours) > 0 ? Math.floor(now + Number(b.hours) * 3600000) : 0;
    if ((await q('SELECT 1 AS x FROM codes WHERE code=$1', [code])).length) return send(res, 400, { error: '這個代碼已存在' });
    await q('INSERT INTO codes(code,em,tier,max_uses,used,expires,enabled,note,created,cards) VALUES($1,$2,$3,$4,0,$5,1,$6,$7,$8)', [code, em, tier, max, exp, String(b.note || '').slice(0, 100), now, JSON.stringify(tpl)]);
    log('newcode', '', code + ' 💚' + em + ' ' + tier + ' x' + max); return send(res, 200, { ok: 1, code });
  }
  if (b.act === 'codeon' || b.act === 'codeoff') { await q('UPDATE codes SET enabled=$1 WHERE code=$2', [b.act === 'codeon' ? 1 : 0, String(b.code || '')]); log(b.act, '', b.code); return send(res, 200, { ok: 1 }); }
  if (b.act === 'delcode') { const c = String(b.code || ''); await q('DELETE FROM codes WHERE code=$1', [c]); await q('DELETE FROM redeems WHERE code=$1', [c]); log('delcode', '', c); return send(res, 200, { ok: 1 }); }
  if (b.act === 'rmban') {
    const kind = String(b.kind), val = String(b.val);
    await q('DELETE FROM bans WHERE kind=$1 AND val=$2', [kind, val]);
    if (kind === 'pid') await q('UPDATE players SET banned=0,ban_reason=NULL WHERE pid=$1', [val]);
    log('rmban', '', kind + ':' + val); return send(res, 200, { ok: 1 });
  }
  if (b.act === 'addban') {
    const kind = String(b.kind), val = String(b.val || '').trim().slice(0, 64);
    if (!['pid', 'ip', 'fp'].includes(kind) || !val) return send(res, 400, { error: 'bad' });
    await add(kind, val, kind === 'pid' ? val : '');
    if (kind === 'pid') await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [reason, now, val]);
    log('addban', '', kind + ':' + val); return send(res, 200, { ok: 1 });
  }
  const pl = (await q('SELECT * FROM players WHERE pid=$1', [pid]))[0];
  if (!pl) return send(res, 404, { error: 'not found' });
  switch (b.act) {
    case 'gift': { const n = Math.floor(Number(b.n)); if (!n || Math.abs(n) > 1e9) return send(res, 400, { error: 'bad n' }); await pushCmd(pid, { t: 'em', n }); log('gift', pid, n); break; }
    case 'tier': if (!['none', 'vip', 'prem', 'eter'].includes(b.v)) return send(res, 400, { error: 'bad' }); await pushCmd(pid, { t: 'tier', v: b.v }); log('tier', pid, b.v); break;
    case 'msg': await pushCmd(pid, { t: 'msg', s: String(b.text || '').slice(0, 300) }); log('msg', pid, b.text); break;
    case 'rename': { const v = String(b.v || '').trim().slice(0, 20); if (!v) return send(res, 400, { error: 'bad' }); await pushCmd(pid, { t: 'name', v }); await q('UPDATE players SET name=$1 WHERE pid=$2', [v, pid]); log('rename', pid, pl.name + ' → ' + v); break; }
    case 'givecard': { const tpl = cleanTpl(b.cards); if (!tpl.length) return send(res, 400, { error: '沒有有效的卡片' }); await pushCmd(pid, { t: 'cards', tpl }); log('givecard', pid, '×' + cardCount(tpl)); break; }
    case 'acceptrej': { if (!pl.rej) return send(res, 400, { error: '沒有被拒絕的存檔' }); let st; try { st = JSON.parse(pl.rej); } catch { return send(res, 400, { error: '存檔損毀' }); } await q('UPDATE players SET rej=NULL WHERE pid=$1', [pid]); await storeState(pid, st); await q('UPDATE players SET tok=$1 WHERE pid=$2', [now, pid]); await pushCmd(pid, { t: 'state', s: JSON.stringify(st) }); log('acceptrej', pid, pl.name); break; }
    case 'trust': await q('UPDATE players SET trust=$1 WHERE pid=$2', [b.on ? 1 : 0, pid]); log(b.on ? 'trust' : 'untrust', pid, pl.name); break;
    case 'clearstrikes': await q('UPDATE players SET strikes=0,rej=NULL WHERE pid=$1', [pid]); break;
    case 'adm': { const on = b.on ? 1 : 0; await q('UPDATE players SET adm=$1 WHERE pid=$2', [on, pid]); if (on) await q('UPDATE players SET tier=$1 WHERE pid=$2', ['管理員', pid]); log(on ? 'adm_grant' : 'adm_revoke', pid, pl.name); break; }
    case 'emset': { const n = Math.floor(Number(b.n)); if (!(n >= 0) || n > 1e12) return send(res, 400, { error: 'bad n' }); await pushCmd(pid, { t: 'emset', n }); log('emset', pid, n); break; }
    case 'note': await q('UPDATE players SET note=$1 WHERE pid=$2', [String(b.v || '').slice(0, 300), pid]); break;
    case 'reset': await pushCmd(pid, { t: 'reset' }); log('reset', pid, pl.name); break;
    case 'ban': {
      await add('pid', pid, pid); if (b.ip !== false) await add('ip', pl.ip, pid); if (b.fp !== false) await add('fp', pl.fp, pid);
      await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [reason, now, pid]);
      const c = [], a = [pid]; if (b.fp !== false && pl.fp) c.push('fp=$' + a.push(pl.fp)); if (b.ip !== false && pl.ip) c.push('ip=$' + a.push(pl.ip));
      const linked = c.length ? await q('SELECT pid FROM players WHERE pid<>$1 AND banned=0 AND (' + c.join(' OR ') + ')', a) : [];
      for (const l of linked) { await add('pid', l.pid, pid); await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', ['關聯帳號：' + reason, now, l.pid]); }
      log('ban', pid, pl.name + '：' + reason + '（連帶 ' + linked.length + ' 個）'); break;
    }
    case 'unban': {
      const v = await q("SELECT val FROM bans WHERE pid=$1 AND kind='pid'", [pid]);
      await q('DELETE FROM bans WHERE pid=$1', [pid]);
      for (const x of [pid, ...v.map(r => r.val)]) await q('UPDATE players SET banned=0,ban_reason=NULL WHERE pid=$1', [x]);
      log('unban', pid, pl.name); break;
    }
    case 'delete': await q('DELETE FROM players WHERE pid=$1', [pid]); log('delete', pid, pl.name); break;
    default: return send(res, 400, { error: 'bad act' });
  }
  send(res, 200, { ok: 1 });
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      try { await init(); if (await banHit('', cookie(req, 'gid'), ipOf(req), '')) { res.writeHead(403, { 'content-type': 'text/html;charset=utf-8' }); return res.end(BANPAGE); }
        const mt = (await q("SELECT v FROM kv WHERE k='maint'"))[0];
        if (mt) { res.writeHead(503, { 'content-type': 'text/html;charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#000;color:#fff;font:20px sans-serif;text-align:center;padding:80px 20px"><h1>🛠️</h1><p>' + mt.v.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]) + '</p>'); }
      } catch (e) { console.error(e); }
      res.writeHead(200, { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' }); return res.end(GAME);
    }
    if (p === '/admin') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' }); return res.end(ADMIN); }
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }
    await init();
    if (p === '/api/save' && req.method === 'POST') return await save(req, res);
    if (p === '/api/redeem' && req.method === 'POST') return await redeem(req, res);
    if (p.startsWith('/api/admin/')) return await admin(req, res, u);
    send(res, 404, { error: 'not found' });
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); }
}).listen(process.env.PORT || 10000, () => console.log('up'));
