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
  const dt = Math.min(Math.max(x.dt, 5), 1800), rP = RANK(P), allowR = x.adm ? 3 : rP, rN = RANK(N), tf = x.adm >= 2 ? 2 : x.adm ? 1.5 : allowR === 3 ? 1.1 : .92, mult = x.adm >= 2 ? 1000 : x.adm ? 100 : allowR === 3 ? 10 : 1, K2 = x.adm >= 2 ? 2 : 1;
  if (!(N.id >= P.id)) return { bad: '卡片編號倒退' };
  const ids = a => new Set((a || []).map(c => c.id)), known = ids(P.cards), nIds = ids(N.cards);
  (P.inv || []).forEach(k => (k.cs || []).forEach(c => known.add(c.id))); (P.esc || []).forEach(e => (e.cs || []).forEach(c => known.add(c.id)));
  let sales = 0; P.cards.forEach(c => { if (!nIds.has(c.id)) sales += maxPrice(c, tf); });
  const nInv = new Set((N.inv || []).map(k => k.id)); (P.inv || []).forEach(k => { if (!nInv.has(k.id)) { sales += Math.floor((k.paid || 0) * .85) + 1; (k.cs || []).forEach(c => { sales += maxPrice(c, tf); }); } });
  const mine = dt * 10 * 8 * mult, base = mine + sales; // 挖礦上限：每秒 10 下、每下最多 8
  // 新卡檢查
  const seen = new Set(); let newCards = [], bad = null;
  N.cards.forEach(c => { if (seen.has(c.id)) bad = '卡片編號重複'; seen.add(c.id); if (!known.has(c.id)) { newCards.push(c); if (!(c.id >= P.id && c.id < N.id)) bad = '憑空出現的卡片'; if (!ECON.D[c.k]) bad = '不存在的卡片'; else if (ECON.D[c.k][4]) bad = '管理員專屬卡片不能憑空出現'; } });
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
  const minCost = 100 * (x.adm >= 2 ? .01 : x.adm ? .1 : allowR === 3 ? .3 : allowR === 2 ? .6 : allowR === 1 ? .8 : 1), packs = Math.ceil(created / 6);
  if (packs > Math.floor((P.em + base) / Math.max(1, minCost)) + 60) return { bad: '卡片數量和綠寶石花費對不上' };
  const nr = [0, 0, 0, 0, 0, 0]; newCards.forEach(c => { nr[ECON.D[c.k][2]]++; });
  const cardsMade = packs * 5, lim5 = Math.ceil(cardsMade * pmax(5) * K2 * 2 + packs / 80 * 2) + 3, lim4 = Math.ceil(cardsMade * pmax(4) * K2 * 2) + 12;
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
const untov = d => { if (!d.tov || !d.treal || typeof d.treal !== 'object') return d; const c = JSON.parse(JSON.stringify(d)), t = d.treal; c.vip = t.vip ? 1 : 0; c.prem = t.prem ? 1 : 0; c.eter = t.eter ? 1 : 0; delete c.tov; delete c.treal; if (c.tadm) { c.adm = 0; delete c.tadm; } return c; };
const tovNow = async (now, grace) => { const r = (await q("SELECT v FROM kv WHERE k='tierov'"))[0]; if (!r) return null; try { const o = JSON.parse(r.v); return !o.until || o.until > now - (grace || 0) ? o : null; } catch { return null; } }; // 全服暫時通行證：存檔和檢查一律用玩家真正的通行證
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
  for (const c of ['ip TEXT', 'fp TEXT', 'ua TEXT', 'note TEXT', 'ban_reason TEXT', 'banned_at BIGINT', "cmds TEXT DEFAULT '[]'", 'hits BIGINT DEFAULT 0', 'adm INTEGER DEFAULT 0', 'dep INTEGER DEFAULT 0', 'perms TEXT', 'tok BIGINT', 'ub BIGINT', 'strikes INTEGER DEFAULT 0', 'rej TEXT', 'trust INTEGER DEFAULT 0', 'acct TEXT', 'pwh TEXT', 'fc TEXT', 'snap_at BIGINT']) await q('ALTER TABLE players ADD COLUMN IF NOT EXISTS ' + c).catch(() => {});
  await q('CREATE UNIQUE INDEX IF NOT EXISTS players_acct ON players(acct)').catch(() => {});
  await q('CREATE UNIQUE INDEX IF NOT EXISTS players_fc ON players(fc)').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS friends(a TEXT,b TEXT,st INTEGER DEFAULT 0,ts BIGINT,PRIMARY KEY(a,b))');
  await q('CREATE INDEX IF NOT EXISTS friends_b ON friends(b)').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS bans(kind TEXT,val TEXT,pid TEXT,reason TEXT,created BIGINT,PRIMARY KEY(kind,val))');
  await q('CREATE TABLE IF NOT EXISTS logs(ts BIGINT,act TEXT,pid TEXT,detail TEXT)');
  await q('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT)');
  await q('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY,em BIGINT DEFAULT 0,tier TEXT DEFAULT \'\',max_uses INTEGER DEFAULT 0,used INTEGER DEFAULT 0,expires BIGINT DEFAULT 0,enabled INTEGER DEFAULT 1,note TEXT,created BIGINT)');
  await q('ALTER TABLE codes ADD COLUMN IF NOT EXISTS cards TEXT').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS redeems(code TEXT,pid TEXT,ts BIGINT,PRIMARY KEY(code,pid))');
  await q("CREATE TABLE IF NOT EXISTS chat(id BIGSERIAL PRIMARY KEY,a TEXT,b TEXT,ts BIGINT,kind TEXT DEFAULT 'msg',body TEXT,x BIGINT,rd INTEGER DEFAULT 0)");
  await q('CREATE INDEX IF NOT EXISTS chat_ab ON chat(a,b)').catch(() => {});
  await q('CREATE INDEX IF NOT EXISTS chat_b ON chat(b,rd)').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS xfers(id BIGSERIAL PRIMARY KEY,a TEXT,b TEXT,ts BIGINT,st INTEGER DEFAULT 0,give TEXT,back TEXT,done BIGINT)');
  await q('CREATE INDEX IF NOT EXISTS xfers_ab ON xfers(a,b)').catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS snaps(pid TEXT,ts BIGINT,em BIGINT,cards BIGINT,why TEXT,data TEXT,PRIMARY KEY(pid,ts))');
})().catch(e => { ready = null; throw e; }));
const banHit = async (pid, gid, ip, fp) => (await q("SELECT kind,pid FROM bans WHERE (kind='pid' AND val IN ($1,$2)) OR (kind='ip' AND val=$3) OR (kind='fp' AND val=$4) LIMIT 1", [pid || '-', gid || '-', ip || '-', fp || '-']))[0] || null;
const UPSERT = 'INSERT INTO players(pid,name,data,em,cards,opened,tier,ip,fp,ua,created,updated,tok,ub) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11,$12) ON CONFLICT(pid) DO UPDATE SET name=EXCLUDED.name,data=EXCLUDED.data,em=EXCLUDED.em,cards=EXCLUDED.cards,opened=EXCLUDED.opened,tier=CASE WHEN players.adm>=2 THEN \'特約\' WHEN players.adm=1 THEN \'管理員\' ELSE EXCLUDED.tier END,ip=EXCLUDED.ip,fp=CASE WHEN EXCLUDED.fp<>\'\' THEN EXCLUDED.fp ELSE players.fp END,ua=EXCLUDED.ua,updated=EXCLUDED.updated,tok=EXCLUDED.tok,ub=EXCLUDED.ub,hits=COALESCE(players.hits,0)+1';
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
  else if (c.t === 'give') { const out = []; for (const x of Array.isArray(c.cs) ? c.cs : []) { if (!x || !ECON.D[x.k]) continue; const card = Object.assign({}, x, { id: (P.gid = (P.gid || 1e9) + 1), lk: 0, pend: 0, pd: 0, t: Date.now() }); P.cards.push(card); out.push(card); P.dex = P.dex || []; P.dex[x.k] = 1; } c.t = 'cards'; c.cs = out; c.gid = P.gid; }
  else if (c.t === 'state') { return 'state'; }
  else return false;
  return true;
}
async function storeState(pid, P) {
  await q('UPDATE players SET data=$1,em=$2,cards=$3,tier=CASE WHEN adm>=2 THEN \'特約\' WHEN adm=1 THEN $4 ELSE $5 END WHERE pid=$6', [JSON.stringify(P), Math.floor(P.em) || 0, P.cards.length, '管理員', TIERNAME(P), pid]);
}
async function snap(pid, P, why) { // 存檔快照：每位玩家最多留 12 份，可在後台還原
  const now = Date.now();
  await q('INSERT INTO snaps(pid,ts,em,cards,why,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(pid,ts) DO NOTHING', [pid, now, Math.floor(P.em) || 0, (P.cards || []).length, why || '', JSON.stringify(P)]);
  await q('UPDATE players SET snap_at=$1 WHERE pid=$2', [now, pid]);
  for (const o of await q('SELECT ts FROM snaps WHERE pid=$1 ORDER BY ts DESC LIMIT 100 OFFSET 12', [pid])) await q('DELETE FROM snaps WHERE pid=$1 AND ts=$2', [pid, o.ts]);
}
async function autoBan(pid, name, sk) { // 異常次數達到後台設定的門檻就自動停權
  const r = (await q("SELECT v FROM kv WHERE k='autoban'"))[0], n = r ? Math.floor(Number(r.v)) : 0; if (!(n > 0) || sk < n) return;
  const cur = (await q('SELECT banned FROM players WHERE pid=$1', [pid]))[0]; if (!cur || cur.banned) return;
  const why = '自動停權：數值異常 ' + sk + ' 次', now = Date.now();
  await q("INSERT INTO bans(kind,val,pid,reason,created) VALUES('pid',$1,$1,$2,$3) ON CONFLICT(kind,val) DO NOTHING", [pid, why, now]);
  await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [why, now, pid]); log('autoban', pid, name + ' ' + why);
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
  const prev = (await q('SELECT data,tok,updated,adm,trust,ub,banned,snap_at FROM players WHERE pid=$1', [pid]))[0];
  let P = null; if (prev && prev.data) { try { P = JSON.parse(prev.data); } catch {} }
  const tvo = await tovNow(now, b.data.tadm ? 600000 : 0), tvAdm = tvo && tvo.adm ? 1 : 0; // 全服暫時管理員通行證（結束後 10 分鐘內仍容許最後一次同步）
  let verdict = { ok: 1, ub: UCAP };
  if (!(prev && (prev.trust || prev.banned))) {
    if (P) verdict = guard(P, d, { dt: (now - (prev.tok || prev.updated || now)) / 1000, adm: prev.adm || tvAdm, ub: prev.ub });
    else verdict = guard(freshState(), d, { dt: 60, adm: (prev ? prev.adm : 0) || tvAdm, ub: 5000 }); // 首次同步：必須和全新存檔差不多，否則先擋下來等管理員確認
  }
  let base = d, fixState = null;
  if (verdict.bad) {
    if (P) { fixState = JSON.parse(JSON.stringify(P)); base = P; }
    else { base = freshState(); fixState = JSON.parse(JSON.stringify(base)); await q(UPSERT, [pid, name, JSON.stringify(base), 500, 0, 0, '普通', ip, fp, ua, now, 5000]); }
    await q('UPDATE players SET name=$1,ip=$2,ua=$3,updated=$4,hits=COALESCE(hits,0)+1,strikes=COALESCE(strikes,0)+1,rej=$5 WHERE pid=$6', [name, ip, ua, now, JSON.stringify(d), pid]);
    log('cheat', pid, name + ' 數值異常，已還原：' + verdict.bad);
    try { await autoBan(pid, name, (await q('SELECT strikes FROM players WHERE pid=$1', [pid]))[0].strikes); } catch (e) { console.error(e); }
  } else {
    await q(UPSERT, [pid, name, JSON.stringify(d), em, cards, opened, tier, ip, fp, ua, now, Math.floor(verdict.ub)]);
    if (P && now - (prev.snap_at || 0) > 3600000) { try { await snap(pid, P, '自動'); } catch (e) { console.error(e); } }
    if (!P && (em > 2e6 || cards > 500)) log('sus', pid, name + ' 首次同步數值很高（💚' + em + '、卡 ' + cards + '）');
  }
  let r = (await q('SELECT banned,ban_reason,cmds,adm,dep FROM players WHERE pid=$1', [pid]))[0];
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
  const frq = (await q('SELECT COUNT(*) AS n FROM friends WHERE b=$1 AND st=0', [pid]))[0].n;
  const unr = (await q('SELECT COUNT(*) AS n FROM chat WHERE b=$1 AND rd=0', [pid]))[0].n + (await q('SELECT COUNT(*) AS n FROM xfers WHERE b=$1 AND st=0', [pid]))[0].n;
  let tov = null; if (kvs.tierov) { try { const o = JSON.parse(kvs.tierov); if (!o.until || o.until > now) tov = { id: o.id, v: o.v, adm: o.adm ? 1 : 0 }; } catch {} }
  send(res, 200, { ok: 1, banned: false, adm: r.adm | 0, dep: r.dep ? 1 : 0, fix: fixState, why: fixState ? verdict.bad : '', cmds, ann: kvs.ann ? JSON.parse(kvs.ann) : null, maint: kvs.maint || '', tov, frq, unr }, h);
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

// ===== 帳號登入 / 好友 =====
const scrypt = (p, s) => new Promise((ok, no) => crypto.scrypt(p, s, 32, (e, k) => e ? no(e) : ok(k)));
const hashPw = async p => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(p, s)).toString('hex'); };
const DUMMYPW = '00000000000000000000000000000000:' + '0'.repeat(64);
const checkPw = async (p, h) => { const [s, k] = String(h || DUMMYPW).split(':'); if (!s || !k) return false; const d = await scrypt(p, Buffer.from(s, 'hex')), kb = Buffer.from(k, 'hex'); return kb.length === d.length && crypto.timingSafeEqual(kb, d) && h !== DUMMYPW; };
const lim = new Map(); // 通用限流：key -> {n,t}
const limHit = (k, max, win) => { const now = Date.now(), x = lim.get(k); return !!(x && x.n >= max && now - x.t < win); };
const limBump = (k, win) => { const now = Date.now(); let x = lim.get(k); if (!x || now - x.t >= win) x = { n: 0, t: now }; x.n++; lim.set(k, x); };
setInterval(() => { const now = Date.now(); for (const [k, x] of lim) if (now - x.t > 3600000) lim.delete(k); }, 1800000).unref();
const FCAL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function ensureFc(pid) {
  const r = (await q('SELECT fc FROM players WHERE pid=$1', [pid]))[0]; if (!r) return null; if (r.fc) return r.fc;
  for (let i = 0; i < 8; i++) {
    let c = ''; for (const x of crypto.randomBytes(8)) c += FCAL[x % 32];
    try { const u = await q('UPDATE players SET fc=$1 WHERE pid=$2 AND fc IS NULL RETURNING fc', [c, pid]); if (u.length) return c; return (await q('SELECT fc FROM players WHERE pid=$1', [pid]))[0].fc; } catch {}
  }
  return null;
}
const TMS = 600000, RESERVED = ['admin', 'administrator', 'root', 'system', 'mod', 'support'];
const pwErr = (p, u) => p.length < 6 || p.length > 64 ? '密碼要 6～64 個字' : (u && p.toLowerCase() === u.toLowerCase()) ? '密碼不能和帳號一樣' : '';
async function jbody(req, res, max) { try { return JSON.parse(await body(req, max || 5000)); } catch { send(res, 400, { error: '格式錯誤' }); return null; } }
async function register(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const pid = String(b.pid || ''), user = String(b.user || '').trim(), pass = String(b.pass || ''), ip = ipOf(req);
  if (limHit('reg:' + ip, 6, 3600000)) return send(res, 200, { error: '註冊太頻繁，請稍後再試' });
  if (!/^[A-Za-z0-9_]{3,16}$/.test(user)) return send(res, 200, { error: '帳號要 3～16 個英文、數字或底線' });
  if (RESERVED.includes(user.toLowerCase())) return send(res, 200, { error: '這個帳號名稱不能用' });
  const pe = pwErr(pass, user); if (pe) return send(res, 200, { error: pe });
  const pl = (await q('SELECT banned,acct FROM players WHERE pid=$1', [pid]))[0];
  if (!pl) return send(res, 200, { error: '請先等遊戲同步完成（約 15 秒）再註冊' });
  if (pl.banned) return send(res, 200, { error: '帳號已被停權' });
  if (pl.acct) return send(res, 200, { error: '這份存檔已經綁定帳號了' });
  limBump('reg:' + ip, 3600000);
  const pwh = await hashPw(pass);
  try { const u = await q('UPDATE players SET acct=$1,pwh=$2 WHERE pid=$3 AND acct IS NULL RETURNING acct', [user.toLowerCase(), pwh, pid]); if (!u.length) return send(res, 200, { error: '這份存檔已經綁定帳號了' }); }
  catch (e) { if (e.code === '23505') return send(res, 200, { error: '這個帳號名稱已經有人用了' }); throw e; }
  log('register', pid, user); send(res, 200, { ok: 1, user: user.toLowerCase() }); // 帳號不分大小寫，一律以小寫顯示
}
async function login(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const user = String(b.user || '').trim().toLowerCase().slice(0, 20), pass = String(b.pass || '').slice(0, 100), ip = ipOf(req);
  if (limHit('lip:' + ip, 60, TMS) || limHit('lu:' + user, 10, TMS)) return send(res, 429, { error: '嘗試次數太多，請 10 分鐘後再試' });
  const row = user ? (await q('SELECT pid,name,data,banned,pwh FROM players WHERE acct=$1', [user]))[0] : null;
  const ok = (await checkPw(pass, row && row.pwh)) && row;
  if (!ok) { limBump('lip:' + ip, TMS); limBump('lu:' + user, TMS); return send(res, 200, { error: '帳號或密碼錯誤' }); }
  if (row.banned) return send(res, 200, { error: '這個帳號已被停權' });
  lim.delete('lu:' + user);
  let data = null; try { data = row.data ? JSON.parse(row.data) : null; } catch {}
  log('login', row.pid, user + ' ' + ip); send(res, 200, { ok: 1, pid: row.pid, name: row.name || '', data });
}
async function passwd(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const pid = String(b.pid || ''), old = String(b.old || '').slice(0, 100), pass = String(b.pass || '');
  if (limHit('pw:' + pid, 8, TMS)) return send(res, 429, { error: '嘗試次數太多，請 10 分鐘後再試' });
  const row = (await q('SELECT acct,pwh,banned FROM players WHERE pid=$1', [pid]))[0];
  if (!row || !row.acct) return send(res, 200, { error: '還沒有註冊帳號' });
  if (!(await checkPw(old, row.pwh))) { limBump('pw:' + pid, TMS); return send(res, 200, { error: '目前的密碼不對' }); }
  const pe = pwErr(pass, row.acct); if (pe) return send(res, 200, { error: pe });
  await q('UPDATE players SET pwh=$1 WHERE pid=$2', [await hashPw(pass), pid]); log('passwd', pid, row.acct); send(res, 200, { ok: 1 });
}
async function friendList(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const pid = String(b.pid || ''), me = (await q('SELECT acct,banned FROM players WHERE pid=$1', [pid]))[0];
  if (!me) return send(res, 200, { error: '請先等遊戲同步完成（約 15 秒）' });
  if (me.banned) return send(res, 200, { error: '帳號已被停權' });
  const fc = await ensureFc(pid), now = Date.now();
  const rows = await q('SELECT f.a,f.st,f.ts,p.fc,p.name,p.em,p.cards,p.opened,p.tier,p.updated,(SELECT COUNT(*) FROM chat c WHERE c.a=p.pid AND c.b=$1 AND c.rd=0) AS unr,(SELECT COUNT(*) FROM xfers x WHERE x.a=p.pid AND x.b=$1 AND x.st=0) AS xin FROM friends f JOIN players p ON p.pid=(CASE WHEN f.a=$1 THEN f.b ELSE f.a END) WHERE (f.a=$1 OR f.b=$1) AND COALESCE(p.banned,0)=0 ORDER BY f.ts DESC LIMIT 400', [pid]);
  const out = { ok: 1, fc, user: me.acct || '', friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    if (r.st === 1) out.friends.push({ fc: r.fc, name: r.name, em: r.em, cards: r.cards, opened: r.opened, tier: r.tier, updated: r.updated, unr: r.unr, xin: r.xin, online: now - r.updated < 150000 });
    else if (r.a === pid) out.outgoing.push({ fc: r.fc, name: r.name, ts: r.ts }); else out.incoming.push({ fc: r.fc, name: r.name, ts: r.ts });
  }
  out.friends.sort((x, y) => (y.online - x.online) || (y.updated - x.updated));
  send(res, 200, out);
}
async function friendAct(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const pid = String(b.pid || ''), act = String(b.act || ''), code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16), now = Date.now();
  const me = (await q('SELECT banned FROM players WHERE pid=$1', [pid]))[0];
  if (!me) return send(res, 200, { error: '請先等遊戲同步完成（約 15 秒）' });
  if (me.banned) return send(res, 200, { error: '帳號已被停權' });
  if (limHit('fr:' + pid, 30, TMS)) return send(res, 429, { error: '操作太頻繁，請稍後再試' }); limBump('fr:' + pid, TMS);
  if (!code) return send(res, 200, { error: '請輸入好友碼' });
  const t = (await q('SELECT pid,name,banned FROM players WHERE fc=$1', [code]))[0];
  if (!t || (t.banned && act === 'add')) return send(res, 200, { error: '找不到這個好友碼' });
  if (t.pid === pid) return send(res, 200, { error: '不能加自己為好友' });
  const rel = (await q('SELECT a,b,st FROM friends WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [pid, t.pid]))[0];
  if (act === 'add') {
    await ensureFc(pid);
    if (rel && rel.st === 1) return send(res, 200, { error: '你們已經是好友了' });
    if (rel && rel.a === pid) return send(res, 200, { error: '已經送出邀請了，等對方接受' });
    if (rel) { await q('UPDATE friends SET st=1,ts=$3 WHERE a=$1 AND b=$2', [t.pid, pid, now]); return send(res, 200, { ok: 1, msg: '🤝 你和 ' + t.name + ' 成為好友了！' }); } // 對方也剛好邀請你 → 直接成為好友
    const n = (await q('SELECT COUNT(*) AS n FROM friends WHERE a=$1 AND st=0', [pid]))[0].n, f = (await q('SELECT COUNT(*) AS n FROM friends WHERE (a=$1 OR b=$1) AND st=1', [pid]))[0].n, tf = (await q('SELECT COUNT(*) AS n FROM friends WHERE (a=$1 OR b=$1) AND st=1', [t.pid]))[0].n;
    if (n >= 30) return send(res, 200, { error: '送出的邀請太多了，先等對方回覆或取消幾個' });
    if (f >= 100) return send(res, 200, { error: '你的好友已達上限 100 人' });
    if (tf >= 100) return send(res, 200, { error: '對方的好友已達上限' });
    await q('INSERT INTO friends(a,b,st,ts) VALUES($1,$2,0,$3) ON CONFLICT DO NOTHING', [pid, t.pid, now]);
    return send(res, 200, { ok: 1, msg: '📨 已送出好友邀請給 ' + t.name });
  }
  if (act === 'accept') {
    if (!rel || rel.st !== 0 || rel.b !== pid) return send(res, 200, { error: '這個邀請已經不存在了' });
    const f = (await q('SELECT COUNT(*) AS n FROM friends WHERE (a=$1 OR b=$1) AND st=1', [pid]))[0].n; if (f >= 100) return send(res, 200, { error: '你的好友已達上限 100 人' });
    await q('UPDATE friends SET st=1,ts=$3 WHERE a=$1 AND b=$2', [t.pid, pid, now]); return send(res, 200, { ok: 1, msg: '🤝 你和 ' + t.name + ' 成為好友了！' });
  }
  if (act === 'remove') { if (rel) await q('DELETE FROM friends WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [pid, t.pid]); return send(res, 200, { ok: 1, msg: rel && rel.st === 1 ? '已移除好友 ' + t.name : '已處理' }); }
  send(res, 400, { error: 'bad act' });
}

// ===== 好友聊天 / 交換卡片 =====
// 聊天內容全部存在 chat 表，管理員後台看得到。交換卡片時卡片會先從出卡人的存檔移到 xfers 表暫存，
// 對方接受才互相發出、拒絕 / 取消 / 逾期則退回，所以卡片不會憑空出現、消失或被複製。
const XMAX = 10, XTTL = 48 * 3600000;
const xOk = c => !!(c && !c.pend && !c.lk && ECON.D[c.k] && ECON.D[c.k][2] < 5 && !ECON.D[c.k][4]);
const cleanIds = a => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, XMAX);
async function mutate(pid, fn) { // 用比對舊資料的方式安全修改存檔（不和玩家自己的同步互相覆蓋）
  for (let i = 0; i < 5; i++) {
    const r = (await q('SELECT data FROM players WHERE pid=$1', [pid]))[0]; if (!r || !r.data) throw new Error('找不到存檔，請先等遊戲同步');
    let P; try { P = JSON.parse(r.data); } catch { throw new Error('存檔損毀'); }
    if (!Array.isArray(P.cards)) throw new Error('存檔格式錯誤');
    const out = fn(P);
    const u = await q('UPDATE players SET data=$1,cards=$2 WHERE pid=$3 AND data=$4 RETURNING pid', [JSON.stringify(P), P.cards.length, pid, r.data]);
    if (u.length) return out;
  }
  throw new Error('系統忙碌，請再試一次');
}
const takeCards = ids => P => { const out = []; for (const id of ids) { const c = P.cards.find(x => x.id === id); if (!c) throw new Error('有卡片已經不在收藏裡了，請重新整理再試'); if (!xOk(c)) throw new Error('有卡片不能交換（已上鎖、鑑定中、創世卡或管理員專屬卡）'); out.push(c); } const set = new Set(ids); P.cards = P.cards.filter(c => !set.has(c.id)); return out; };
const slim = c => ({ id: c.id, k: c.k, foil: c.foil ? 1 : 0, ser: c.ser, max: c.max, grade: c.grade || 0, en: c.en || [] });
async function peerOf(pid, fc) { // 回傳好友資料（必須互為好友、沒被停權）
  const code = String(fc || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const t = code && (await q('SELECT pid,name,banned,updated FROM players WHERE fc=$1', [code]))[0];
  if (!t || t.pid === pid) return null;
  const r = (await q('SELECT st FROM friends WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [pid, t.pid]))[0];
  return r && r.st === 1 ? t : null;
}
async function chatGate(req, res, bodyMax) {
  const b = await jbody(req, res, bodyMax); if (!b) return null;
  const pid = String(b.pid || ''), me = (await q('SELECT banned,name FROM players WHERE pid=$1', [pid]))[0];
  if (!me) { send(res, 200, { error: '請先等遊戲同步完成（約 15 秒）' }); return null; }
  if (me.banned) { send(res, 200, { error: '帳號已被停權' }); return null; }
  return { b, pid, me };
}
async function xferSweep() { // 逾期沒人回應的交換：卡片退回給出卡的人
  const now = Date.now(), rows = await q('UPDATE xfers SET st=4,done=$1 WHERE st=0 AND ts<$2 RETURNING id,a,b,give', [now, now - XTTL]);
  for (const x of rows) { try { await pushCmd(x.a, { t: 'give', cs: JSON.parse(x.give || '[]') }); await q("INSERT INTO chat(a,b,ts,kind,body,x,rd) VALUES($1,$2,$3,'xres','逾期',$4,1)", [x.a, x.b, now, x.id]); } catch (e) { console.error(e); } }
}
setInterval(() => xferSweep().catch(() => {}), 600000).unref();
async function chatList(req, res) {
  const g = await chatGate(req, res); if (!g) return; const { b, pid } = g;
  const peer = await peerOf(pid, b.fc); if (!peer) return send(res, 200, { error: '你們還不是好友' });
  await xferSweep();
  const after = Math.max(0, Math.floor(Number(b.after)) || 0), now = Date.now();
  const rows = (await q('SELECT id,a,ts,kind,body,x FROM chat WHERE ((a=$1 AND b=$2) OR (a=$2 AND b=$1)) AND id>$3 ORDER BY id DESC LIMIT 80', [pid, peer.pid, after])).reverse();
  await q('UPDATE chat SET rd=1 WHERE b=$1 AND a=$2 AND rd=0', [pid, peer.pid]);
  const xf = (await q('SELECT id,a,ts,st,give,back,done FROM xfers WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1) ORDER BY id DESC LIMIT 12', [pid, peer.pid])).map(x => { let give = [], back = []; try { give = JSON.parse(x.give || '[]'); } catch {} try { back = JSON.parse(x.back || '[]'); } catch {} return { id: x.id, me: x.a === pid ? 1 : 0, ts: x.ts, st: x.st, done: x.done, give, back }; });
  send(res, 200, { ok: 1, peer: { name: peer.name, online: now - peer.updated < 150000 }, msgs: rows.map(m => ({ id: m.id, me: m.a === pid ? 1 : 0, ts: m.ts, k: m.kind, t: m.body, x: m.x })), xf });
}
async function chatSend(req, res) {
  const g = await chatGate(req, res); if (!g) return; const { b, pid } = g;
  const text = String(b.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!text) return send(res, 200, { error: '請輸入訊息' });
  const peer = await peerOf(pid, b.fc); if (!peer) return send(res, 200, { error: '你們還不是好友' });
  if (peer.banned) return send(res, 200, { error: '對方帳號目前無法收訊息' });
  if (limHit('cs:' + pid, 20, 60000)) return send(res, 429, { error: '說話太快了，請稍等一下' }); limBump('cs:' + pid, 60000);
  const r = await q("INSERT INTO chat(a,b,ts,kind,body) VALUES($1,$2,$3,'msg',$4) RETURNING id", [pid, peer.pid, Date.now(), text]);
  send(res, 200, { ok: 1, id: r[0].id });
}
async function xferOffer(req, res) {
  const g = await chatGate(req, res); if (!g) return; const { b, pid, me } = g;
  const ids = cleanIds(b.ids); if (!ids.length) return send(res, 200, { error: '請先選擇要交換的卡片（最多 ' + XMAX + ' 張）' });
  const peer = await peerOf(pid, b.fc); if (!peer) return send(res, 200, { error: '你們還不是好友' });
  if (peer.banned) return send(res, 200, { error: '對方帳號目前無法收卡片' });
  if (limHit('xo:' + pid, 10, 600000)) return send(res, 429, { error: '操作太頻繁，請稍後再試' }); limBump('xo:' + pid, 600000);
  if ((await q('SELECT COUNT(*) AS n FROM xfers WHERE a=$1 AND st=0', [pid]))[0].n >= 8) return send(res, 200, { error: '你送出的交換邀請太多了，先等對方回覆或取消幾個' });
  let taken; try { taken = (await mutate(pid, takeCards(ids))).map(slim); } catch (e) { return send(res, 200, { error: e.message }); }
  const now = Date.now(), note = String(b.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
  try {
    const x = await q('INSERT INTO xfers(a,b,ts,st,give) VALUES($1,$2,$3,0,$4) RETURNING id', [pid, peer.pid, now, JSON.stringify(taken)]);
    await q("INSERT INTO chat(a,b,ts,kind,body,x) VALUES($1,$2,$3,'xfer',$4,$5)", [pid, peer.pid, now, note, x[0].id]);
    log('xfer_offer', pid, me.name + ' → ' + peer.name + ' ×' + taken.length + (note ? '：' + note : ''));
    send(res, 200, { ok: 1, id: x[0].id });
  } catch (e) { console.error(e); try { await pushCmd(pid, { t: 'give', cs: taken }); } catch {} send(res, 200, { error: '送出失敗，卡片會退回到你的收藏' }); }
}
async function xferAnswer(req, res, mode) { // mode: accept / reject（收件人）、cancel（出卡人）
  const g = await chatGate(req, res); if (!g) return; const { b, pid, me } = g;
  const id = Math.floor(Number(b.id)) || 0, now = Date.now();
  const x = id && (await q('SELECT id,a,b,ts,st,give FROM xfers WHERE id=$1', [id]))[0];
  if (!x || x.st !== 0 || (mode === 'cancel' ? x.a : x.b) !== pid) return send(res, 200, { error: '這個交換已經結束或不存在了' });
  const other = (await q('SELECT pid,name,banned FROM players WHERE pid=$1', [mode === 'cancel' ? x.b : x.a]))[0];
  const give = JSON.parse(x.give || '[]'), msg = t => q("INSERT INTO chat(a,b,ts,kind,body,x,rd) VALUES($1,$2,$3,'xres',$4,$5,0)", [pid, mode === 'cancel' ? x.b : x.a, now, t, x.id]);
  if (mode === 'reject' || mode === 'cancel') {
    const c = await q('UPDATE xfers SET st=$1,done=$2 WHERE id=$3 AND st=0 RETURNING id', [mode === 'reject' ? 2 : 3, now, x.id]); if (!c.length) return send(res, 200, { error: '這個交換已經結束了' });
    await pushCmd(x.a, { t: 'give', cs: give }); await msg(mode === 'reject' ? '拒絕' : '取消'); log('xfer_' + mode, pid, me.name + ' #' + x.id);
    return send(res, 200, { ok: 1 });
  }
  const back = cleanIds(b.ids);
  if (now - x.ts > XTTL) return send(res, 200, { error: '這個交換已經逾期了' });
  if (!other || other.banned) return send(res, 200, { error: '對方帳號目前無法收卡片' });
  const fr = (await q('SELECT st FROM friends WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [pid, x.a]))[0]; if (!fr || fr.st !== 1) return send(res, 200, { error: '你們已經不是好友了' });
  const c = await q('UPDATE xfers SET st=1,done=$1 WHERE id=$2 AND st=0 RETURNING id', [now, x.id]); if (!c.length) return send(res, 200, { error: '這個交換已經結束了' });
  let backCards = [];
  if (back.length) { try { backCards = (await mutate(pid, takeCards(back))).map(slim); } catch (e) { await q('UPDATE xfers SET st=0,done=NULL WHERE id=$1', [x.id]); return send(res, 200, { error: e.message }); } }
  await q('UPDATE xfers SET back=$1 WHERE id=$2', [JSON.stringify(backCards), x.id]);
  await pushCmd(pid, { t: 'give', cs: give }); if (backCards.length) await pushCmd(x.a, { t: 'give', cs: backCards });
  await msg(backCards.length ? '接受並回送 ' + backCards.length + ' 張' : '接受');
  log('xfer_accept', pid, me.name + ' ← ' + other.name + ' 收 ' + give.length + ' 張、回送 ' + backCards.length + ' 張');
  send(res, 200, { ok: 1 });
}
const fails = new Map();
async function isAdmin(req) {
  const w = process.env.ADMIN_PASSWORD; if (!w) return false;
  return crypto.timingSafeEqual(sha(String(req.headers['x-admin'] || '')), sha(w));
}
const SORT = { recent: 'updated DESC', em: 'em DESC', strikes: 'COALESCE(strikes,0) DESC', cards: 'cards DESC', opened: 'opened DESC', new: 'created DESC' };
async function chatQuery(u) { // 看玩家聊天：pid=某位玩家的全部對話；with=和某位玩家的對話；q=搜尋文字
    const w = [], a = [], gp = u.searchParams.get('pid'), gw = u.searchParams.get('with'), gq = (u.searchParams.get('q') || '').toLowerCase();
    if (gp && gw) { a.push(gp, gw); w.push('((c.a=$1 AND c.b=$2) OR (c.a=$2 AND c.b=$1))'); } else if (gp) { a.push(gp); w.push('(c.a=$1 OR c.b=$1)'); }
    if (gq) { a.push('%' + gq + '%'); w.push("LOWER(COALESCE(c.body,'')) LIKE $" + a.length); }
    const lm = Math.min(500, Math.floor(Number(u.searchParams.get('n'))) || 200);
    const rows = await q('SELECT c.id,c.ts,c.a,c.b,c.kind,c.body,c.x,pa.name AS an,pb.name AS bn FROM chat c LEFT JOIN players pa ON pa.pid=c.a LEFT JOIN players pb ON pb.pid=c.b' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY c.id DESC LIMIT ' + lm, a);
    const xids = [...new Set(rows.filter(r => r.x).map(r => Number(r.x)))].filter(n => Number.isInteger(n)), xf = {};
    if (xids.length) for (const x of await q('SELECT id,st,give,back FROM xfers WHERE id IN (' + xids.join(',') + ')')) { let give = [], back = []; try { give = JSON.parse(x.give || '[]'); } catch {} try { back = JSON.parse(x.back || '[]'); } catch {} xf[x.id] = { st: x.st, give, back }; }
    return { msgs: rows, xf, total: (await q('SELECT COUNT(*) AS n FROM chat'))[0].n };
}

// ===== 管理員特約玩家：用自己的遊戲帳號登入後台，只能使用被授權的一小部分功能 =====
const PERMS = ['view', 'chat', 'msg', 'ban'], deps = new Map(), DEPTTL = 12 * 3600000, DPFX = '【特約】';
const cleanPerms = a => PERMS.filter(x => Array.isArray(a) && a.includes(x));
async function depLogin(req, res) {
  const b = await jbody(req, res); if (!b) return;
  const user = String(b.user || '').trim().toLowerCase().slice(0, 20), pass = String(b.pass || '').slice(0, 100), ip = ipOf(req);
  if (limHit('dip:' + ip, 30, TMS) || limHit('du:' + user, 8, TMS)) return send(res, 429, { error: '嘗試次數太多，請 10 分鐘後再試' });
  const row = user ? (await q('SELECT pid,name,banned,pwh,dep,perms FROM players WHERE acct=$1', [user]))[0] : null;
  const ok = (await checkPw(pass, row && row.pwh)) && row && row.dep === 1 && !row.banned;
  if (!ok) { limBump('dip:' + ip, TMS); limBump('du:' + user, TMS); return send(res, 200, { error: '帳號或密碼錯誤，或這個帳號不是特約玩家' }); }
  lim.delete('du:' + user);
  const now = Date.now(); for (const [t, v] of deps) if (v.exp < now) deps.delete(t);
  const tok = crypto.randomBytes(24).toString('hex'); deps.set(tok, { pid: row.pid, exp: now + DEPTTL });
  let pm = []; try { pm = cleanPerms(JSON.parse(row.perms || '[]')); } catch {}
  log('dep_login', row.pid, row.name + ' ' + ip); send(res, 200, { ok: 1, token: tok, name: row.name || '', perms: pm });
}
async function depInner(req, res, u) {
  const ip = ipOf(req), f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 600000) return send(res, 429, { error: 'too many' });
  const t = deps.get(String(req.headers['x-dep'] || '')), now = Date.now();
  const me = t && t.exp > now ? (await q('SELECT pid,name,banned,dep,perms FROM players WHERE pid=$1', [t.pid]))[0] : null;
  if (!me || me.dep !== 1 || me.banned) { const x = f && now - f.t < 600000 ? f : { n: 0 }; x.n++; x.t = now; fails.set(ip, x); return send(res, 401, { error: 'unauthorized' }); }
  let pm = []; try { pm = cleanPerms(JSON.parse(me.perms || '[]')); } catch {}
  const need = k => pm.includes(k) ? true : (send(res, 403, { error: '你沒有這個權限' }), false), tag = DPFX + me.name, p = u.pathname;
  if (p === '/api/admin/me' && req.method !== 'POST') return send(res, 200, { dep: 1, pid: me.pid, name: me.name, perms: pm });
  if (p === '/api/admin/list' && req.method !== 'POST') {
    if (!need('view')) return; const qs = (u.searchParams.get('q') || '').toLowerCase(), fl = u.searchParams.get('f'), w = [], a = [];
    if (qs) { a.push('%' + qs + '%'); w.push(`(LOWER(name) LIKE $1 OR LOWER(pid) LIKE $1)`); }
    if (fl === 'banned') w.push('banned=1'); else if (fl === 'online') { a.push(now - 120000); w.push('updated>$' + a.length); }
    const rows = await q('SELECT pid,name,em,cards,opened,tier,banned,created,updated,strikes,adm,dep FROM players' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY ' + (SORT[u.searchParams.get('s')] || SORT.recent) + ' LIMIT 100', a);
    return send(res, 200, { players: rows });
  }
  if (p === '/api/admin/player' && req.method !== 'POST') {
    if (!need('view')) return; const pl = (await q('SELECT pid,name,em,cards,opened,tier,banned,ban_reason,created,updated,strikes,adm,dep FROM players WHERE pid=$1', [u.searchParams.get('pid') || '']))[0];
    return pl ? send(res, 200, { player: pl }) : send(res, 404, { error: 'not found' });
  }
  if (p === '/api/admin/chat' && req.method !== 'POST') { if (!need('chat')) return; return send(res, 200, await chatQuery(u)); }
  if (req.method !== 'POST') return send(res, 403, { error: '你沒有這個權限' });
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
  if (limHit('dact:' + me.pid, 40, 600000)) return send(res, 429, { error: '操作太頻繁，請稍後再試' });
  if (p === '/api/admin/broadcast') {
    if (!need('msg')) return; const c = b.cmd || {}; if (c.t !== 'msg') return send(res, 403, { error: '特約玩家只能發文字訊息' });
    if (limHit('dbc:' + me.pid, 3, 600000)) return send(res, 429, { error: '全服訊息 10 分鐘內最多 3 次' }); limBump('dbc:' + me.pid, 600000); limBump('dact:' + me.pid, 600000);
    const s = String(c.s || '').slice(0, 300); if (!s.trim()) return send(res, 400, { error: '訊息是空的' });
    const rows = await q('SELECT pid FROM players WHERE banned=0 AND updated>$1 LIMIT 2000', [now - 120000]);
    for (const r of rows) await pushCmd(r.pid, { t: 'msg', s: '【' + me.name + '】' + s });
    log('dep_broadcast', me.pid, tag + ' ' + s); return send(res, 200, { ok: 1, n: rows.length });
  }
  if (p !== '/api/admin/act') return send(res, 403, { error: '你沒有這個權限' });
  limBump('dact:' + me.pid, 600000);
  const pid = String(b.pid || ''), pl = (await q('SELECT pid,name,banned,ban_reason,adm,dep FROM players WHERE pid=$1', [pid]))[0];
  if (!pl) return send(res, 404, { error: '找不到這位玩家' });
  if (b.act === 'msg') {
    if (!need('msg')) return; const s = String(b.text || '').slice(0, 300); if (!s.trim()) return send(res, 400, { error: '訊息是空的' });
    await pushCmd(pid, { t: 'msg', s: '【' + me.name + '】' + s }); log('dep_msg', pid, tag + ' → ' + pl.name + '：' + s); return send(res, 200, { ok: 1 });
  }
  if (b.act === 'ban') {
    if (!need('ban')) return; if (pl.adm > 0 || pl.dep === 1 || pl.pid === me.pid) return send(res, 403, { error: '不能停權管理員或特約玩家（也不能停權自己）' });
    const reason = DPFX + String(b.reason || '違規').slice(0, 80);
    await q("INSERT INTO bans(kind,val,pid,reason,created) VALUES('pid',$1,$1,$2,$3) ON CONFLICT(kind,val) DO UPDATE SET pid=EXCLUDED.pid,reason=EXCLUDED.reason", [pid, reason, now]);
    await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [reason, now, pid]);
    log('dep_ban', pid, tag + ' → ' + pl.name + '：' + reason); return send(res, 200, { ok: 1 });
  }
  if (b.act === 'unban') {
    if (!need('ban')) return; if (!String(pl.ban_reason || '').startsWith(DPFX)) return send(res, 403, { error: '只能解除特約玩家自己停權的人，其他請找管理員' });
    await q("DELETE FROM bans WHERE pid=$1 AND kind='pid' AND reason LIKE $2", [pid, DPFX + '%']); await q('UPDATE players SET banned=0,ban_reason=NULL WHERE pid=$1', [pid]);
    log('dep_unban', pid, tag + ' → ' + pl.name); return send(res, 200, { ok: 1 });
  }
  return send(res, 403, { error: '你沒有這個權限' });
}
async function admin(req, res, u) {
  try { return await (req.headers['x-dep'] && !req.headers['x-admin'] ? depInner(req, res, u) : adminInner(req, res, u)); } catch (e) { console.error(e); return send(res, 500, { error: 'server error: ' + String(e.message).slice(0, 150) }); }
}
async function adminInner(req, res, u) {
  const ip = ipOf(req), f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 600000) return send(res, 429, { error: 'too many' });
  if (!(await isAdmin(req))) { const x = f && Date.now() - f.t < 600000 ? f : { n: 0 }; x.n++; x.t = Date.now(); fails.set(ip, x); return send(res, 401, { error: 'unauthorized' }); }
  fails.delete(ip);
  const p = u.pathname, now = Date.now();
  if (p === '/api/admin/stats') {
    const r = (await q('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN updated>$1 THEN 1 ELSE 0 END),0) AS online, COALESCE(SUM(CASE WHEN updated>$2 THEN 1 ELSE 0 END),0) AS active24, COALESCE(SUM(CASE WHEN banned=1 THEN 1 ELSE 0 END),0) AS banned, COALESCE(SUM(em),0) AS em, COALESCE(SUM(opened),0) AS opened, COALESCE(SUM(CASE WHEN adm>0 THEN 1 ELSE 0 END),0) AS adm FROM players', [now - 120000, now - 86400000]))[0];
    r.bans = (await q('SELECT COUNT(*) AS n FROM bans'))[0].n; r.codes = (await q('SELECT COUNT(*) AS n FROM codes'))[0].n; return send(res, 200, r);
  }
  if (p === '/api/admin/list') {
    const where = [], a = [], qs = (u.searchParams.get('q') || '').toLowerCase(), fl = u.searchParams.get('f');
    if (qs) { a.push('%' + qs + '%'); const n = '$' + a.length; where.push(`(LOWER(name) LIKE ${n} OR LOWER(pid) LIKE ${n} OR LOWER(COALESCE(ip,'')) LIKE ${n} OR LOWER(COALESCE(acct,'')) LIKE ${n})`); }
    if (fl === 'banned') where.push('banned=1'); else if (fl === 'adm') where.push('adm>0'); else if (fl === 'dep') where.push('dep=1'); else if (fl === 'acct') where.push('acct IS NOT NULL'); else if (fl === 'sus') where.push('COALESCE(strikes,0)>0'); else if (fl === 'trust') where.push('trust=1'); else if (fl === 'online') { a.push(now - 120000); where.push('updated>$' + a.length); }
    const rows = await q('SELECT pid,name,acct,em,cards,opened,tier,banned,ip,created,updated,strikes,adm,dep FROM players' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ' + (SORT[u.searchParams.get('s')] || SORT.recent) + ' LIMIT 300', a);
    return send(res, 200, { players: rows });
  }
  if (p === '/api/admin/player') {
    const pl = (await q('SELECT * FROM players WHERE pid=$1', [u.searchParams.get('pid') || '']))[0];
    if (!pl) return send(res, 404, { error: 'not found' });
    delete pl.pwh;
    const c = [], a = [pl.pid];
    if (pl.fp) c.push('fp=$' + a.push(pl.fp)); if (pl.ip) c.push('ip=$' + a.push(pl.ip));
    const related = c.length ? await q('SELECT pid,name,banned FROM players WHERE pid<>$1 AND (' + c.join(' OR ') + ') LIMIT 20', a) : [];
    const redeems = await q('SELECT code,ts FROM redeems WHERE pid=$1 ORDER BY ts DESC LIMIT 20', [pl.pid]);
    const friends = await q('SELECT f.a,f.b,f.st,pa.name AS an,pb.name AS bn FROM friends f LEFT JOIN players pa ON pa.pid=f.a LEFT JOIN players pb ON pb.pid=f.b WHERE f.a=$1 OR f.b=$1 LIMIT 50', [pl.pid]);
    const snaps = await q('SELECT ts,em,cards,why FROM snaps WHERE pid=$1 ORDER BY ts DESC LIMIT 12', [pl.pid]);
    return send(res, 200, { player: pl, related, redeems, friends, snaps });
  }
  if (p === '/api/admin/bans') return send(res, 200, { bans: await q('SELECT b.kind,b.val,b.pid,b.reason,b.created,p.name FROM bans b LEFT JOIN players p ON p.pid=b.pid ORDER BY b.created DESC LIMIT 300') });
  if (p === '/api/admin/cardlist') return send(res, 200, { cards: ECON.D.map((d, k) => ({ k, n: d[0], e: d[1], r: d[2], p: d[3], ao: d[4] ? 1 : 0, mod: d[5] || '', max: ECON.RUN[d[2]] })), en: ECON.EN.map(e => e[0]) });
  if (p === '/api/admin/codes') return send(res, 200, { codes: await q('SELECT * FROM codes ORDER BY created DESC LIMIT 300') });
  if (p === '/api/admin/codeusers') return send(res, 200, { users: await q('SELECT r.pid,r.ts,p.name FROM redeems r LEFT JOIN players p ON p.pid=r.pid WHERE r.code=$1 ORDER BY r.ts DESC LIMIT 200', [u.searchParams.get('code') || '']) });
  if (p === '/api/admin/logs') {
    const w = [], a = [], gp = u.searchParams.get('pid'), ga = u.searchParams.get('act'), gq = (u.searchParams.get('q') || '').toLowerCase();
    if (gp) { a.push(gp); w.push('pid=$' + a.length); } if (ga) { a.push(ga); w.push('act=$' + a.length); } if (gq) { a.push('%' + gq + '%'); w.push("LOWER(COALESCE(detail,'')) LIKE $" + a.length); }
    const lim = Math.min(500, Math.floor(Number(u.searchParams.get('n'))) || 100);
    return send(res, 200, { logs: await q('SELECT ts,act,pid,detail FROM logs' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY ts DESC LIMIT ' + lim, a), acts: (await q('SELECT DISTINCT act FROM logs ORDER BY act')).map(r => r.act) });
  }
  if (p === '/api/admin/chat') return send(res, 200, await chatQuery(u));
  if (p === '/api/admin/dash') {
    const top = col => q('SELECT pid,name,' + col + ' AS v FROM players WHERE banned=0 ORDER BY ' + col + ' DESC LIMIT 10');
    const day = 86400000, off = 8 * 3600000, days = []; for (let i = 6; i >= 0; i--) { const k = Math.floor((now + off) / day) - i; days.push({ d: new Date(k * day).toISOString().slice(5, 10), n: 0, k }); }
    for (const r of await q('SELECT created FROM players WHERE created>$1', [now - 7 * day])) { const x = days.find(y => y.k === Math.floor((r.created + off) / day)); if (x) x.n++; }
    const c = (await q('SELECT COALESCE(SUM(CASE WHEN acct IS NOT NULL THEN 1 ELSE 0 END),0) AS acct, COALESCE(SUM(CASE WHEN COALESCE(strikes,0)>0 THEN 1 ELSE 0 END),0) AS sus, COALESCE(SUM(CASE WHEN trust=1 THEN 1 ELSE 0 END),0) AS trust, COALESCE(SUM(cards),0) AS cards FROM players'))[0];
    let dbsize = null; try { dbsize = (await q('SELECT pg_database_size(current_database()) AS s'))[0].s; } catch {}
    const ab = (await q("SELECT v FROM kv WHERE k='autoban'"))[0];
    return send(res, 200, { em: await top('em'), cards: await top('cards'), opened: await top('opened'), tiers: await q('SELECT tier,COUNT(*) AS n FROM players GROUP BY tier'), days: days.map(x => ({ d: x.d, n: x.n })), c, autoban: ab ? Number(ab.v) : 0, sys: { up: Math.floor(process.uptime()), rss: process.memoryUsage().rss, node: process.version, dbsize, snaps: (await q('SELECT COUNT(*) AS n FROM snaps'))[0].n } });
  }
  if (p === '/api/admin/export') {
    const rows = await q('SELECT pid,name,acct,em,cards,opened,tier,banned,ban_reason,ip,fp,note,adm,strikes,trust,fc,created,updated' + (u.searchParams.get('data') === '1' ? ',data' : '') + ' FROM players ORDER BY created LIMIT 3000');
    return send(res, 200, { at: now, players: rows, codes: await q('SELECT * FROM codes'), bans: await q('SELECT * FROM bans'), kv: await q('SELECT k,v FROM kv') });
  }
  if (p === '/api/admin/snap') { const r = (await q('SELECT data FROM snaps WHERE pid=$1 AND ts=$2', [u.searchParams.get('pid') || '', Number(u.searchParams.get('ts')) || 0]))[0]; return r ? send(res, 200, { data: r.data }) : send(res, 404, { error: '找不到這份快照' }); }
  if (p === '/api/admin/tierov' && req.method !== 'POST') { const r = (await q("SELECT v FROM kv WHERE k='tierov'"))[0]; let o = null; try { o = r && JSON.parse(r.v); } catch {} if (o && o.until && o.until <= now) o = null; return send(res, 200, { tierov: o }); }
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
  if (p === '/api/admin/autoban') { const n = Math.max(0, Math.min(100, Math.floor(Number(b.n)) || 0)); await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['autoban', String(n)]); log('autoban_set', '', n ? '異常 ' + n + ' 次自動停權' : '(關閉)'); return send(res, 200, { ok: 1 }); }
  if (p === '/api/admin/batch') {
    const pids = (Array.isArray(b.pids) ? b.pids : []).map(String).slice(0, 300); if (!pids.length) return send(res, 400, { error: '沒有選任何玩家' });
    const act = String(b.act || ''); let n = 0, tpl = null, g = 0;
    if (act === 'gift') { g = Math.floor(Number(b.n)); if (!g || Math.abs(g) > 1e9) return send(res, 400, { error: 'bad n' }); }
    else if (act === 'tier') { if (!['none', 'vip', 'prem', 'eter'].includes(b.v)) return send(res, 400, { error: 'bad' }); }
    else if (act === 'cards') { tpl = cleanTpl(b.cards); if (!tpl.length) return send(res, 400, { error: '沒有有效的卡片' }); }
    else if (!['msg', 'ban', 'unban', 'adm', 'trust', 'note'].includes(act)) return send(res, 400, { error: 'bad act' });
    const reason = String(b.reason || '違規').slice(0, 100);
    for (const pid of pids) {
      const pl = (await q('SELECT pid,name,fp,ip FROM players WHERE pid=$1', [pid]))[0]; if (!pl) continue; n++;
      if (act === 'gift') await pushCmd(pid, { t: 'em', n: g });
      else if (act === 'tier') await pushCmd(pid, { t: 'tier', v: b.v });
      else if (act === 'cards') await pushCmd(pid, { t: 'cards', tpl });
      else if (act === 'msg') await pushCmd(pid, { t: 'msg', s: String(b.text || '').slice(0, 300) });
      else if (act === 'note') await q('UPDATE players SET note=$1 WHERE pid=$2', [String(b.v || '').slice(0, 300), pid]);
      else if (act === 'trust') await q('UPDATE players SET trust=$1 WHERE pid=$2', [b.on ? 1 : 0, pid]);
      else if (act === 'adm') { const lv = b.on ? (Number(b.lv) === 2 ? 2 : 1) : 0; await q('UPDATE players SET adm=$1 WHERE pid=$2', [lv, pid]); if (lv) await q('UPDATE players SET tier=$1 WHERE pid=$2', [lv === 2 ? '特約' : '管理員', pid]); }
      else if (act === 'ban') {
        const ad = (kind, val) => val && q('INSERT INTO bans(kind,val,pid,reason,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,val) DO UPDATE SET pid=EXCLUDED.pid,reason=EXCLUDED.reason', [kind, val, pid, reason, now]);
        await ad('pid', pid); if (b.ip) await ad('ip', pl.ip); if (b.fp) await ad('fp', pl.fp);
        await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [reason, now, pid]);
      } else if (act === 'unban') {
        const v = await q("SELECT val FROM bans WHERE pid=$1 AND kind='pid'", [pid]); await q('DELETE FROM bans WHERE pid=$1', [pid]);
        for (const x of [pid, ...v.map(r => r.val)]) await q('UPDATE players SET banned=0,ban_reason=NULL WHERE pid=$1', [x]);
      }
    }
    log('batch', '', act + ' × ' + n + (act === 'gift' ? ' (' + g + ')' : '')); return send(res, 200, { ok: 1, n });
  }
  if (p === '/api/admin/announce') {
    const t = String(b.text || '').slice(0, 500);
    if (t) await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['ann', JSON.stringify({ id: now, text: t })]); else await q("DELETE FROM kv WHERE k='ann'");
    log('announce', '', t || '(清除)'); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/tierov') { // 全服暫時通行證：v = none/vip/prem/eter/keep，空字串 = 關閉；hours 0 = 手動關閉前一直有效；adm = 同時給管理員特別通行證
    const v = String(b.v || '');
    if (!v) { const r = (await q("SELECT v FROM kv WHERE k='tierov'"))[0]; let o = null; try { o = r && JSON.parse(r.v); } catch {} if (o && o.adm) { o.until = now; await q("UPDATE kv SET v=$1 WHERE k='tierov'", [JSON.stringify(o)]); } else await q("DELETE FROM kv WHERE k='tierov'"); }
    else { const adm = b.adm ? 1 : 0; if (!(FLAGS[v] || (v === 'keep' && adm))) return send(res, 400, { error: '「不改通行證」必須搭配管理員特別通行證' }); const h = Number(b.hours) > 0 ? Math.min(720, Number(b.hours)) : 0; await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['tierov', JSON.stringify({ id: now, v, adm, until: h ? Math.floor(now + h * 3600000) : 0 })]); }
    log('tierov', '', v ? v + (b.adm ? ' +管理員' : '') + ' ' + (b.hours || 0) + 'h' : '(關閉)'); return send(res, 200, { ok: 1 });
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
    const rows = await q('SELECT pid FROM players WHERE banned=0 AND updated>$1 LIMIT 2000', [now - 120000]); // 只發給「現在在線」的玩家（2 分鐘內有同步過），離線的不會補發
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
  if (b.act === 'newcodes') { // 一次產生很多組隨機代碼（內容相同，每組預設只能兌換 1 次）
    const cnt = Math.min(200, Math.max(1, Math.floor(Number(b.count)) || 1)), em = Math.floor(Number(b.em)) || 0, tier = ['vip', 'prem', 'eter'].includes(b.tier) ? b.tier : '', tpl = cleanTpl(b.cards);
    if (em < 0 || em > 1e9 || (!em && !tier && !tpl.length)) return send(res, 400, { error: '至少要設定綠寶石、通行證或卡片' });
    const max = Math.max(0, Math.floor(Number(b.max))); const mx = Number.isFinite(max) && b.max !== '' && b.max != null ? max : 1, exp = Number(b.hours) > 0 ? Math.floor(now + Number(b.hours) * 3600000) : 0, pre = String(b.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = [];
    for (let i = 0; i < cnt; i++) {
      let code = ''; for (const x of crypto.randomBytes(10)) code += al[x % al.length]; code = pre ? pre + '-' + code : code;
      await q('INSERT INTO codes(code,em,tier,max_uses,used,expires,enabled,note,created,cards) VALUES($1,$2,$3,$4,0,$5,1,$6,$7,$8) ON CONFLICT(code) DO NOTHING', [code, em, tier, mx, exp, String(b.note || '').slice(0, 100), now, JSON.stringify(tpl)]); out.push(code);
    }
    log('newcodes', '', '×' + cnt + ' 💚' + em + ' ' + tier); return send(res, 200, { ok: 1, codes: out });
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
    case 'setstate': { let st; try { st = JSON.parse(String(b.json || '')); } catch { return send(res, 400, { error: 'JSON 格式錯誤' }); }
      if (!st || typeof st !== 'object' || !Array.isArray(st.cards) || !Number.isFinite(st.em) || st.em < 0 || st.em > 1e13 || !(st.id >= 1)) return send(res, 400, { error: '存檔缺少必要欄位（em、cards、id）' });
      if (pl.data) { try { await snap(pid, JSON.parse(pl.data), '編輯前'); } catch {} }
      await storeState(pid, st); await q('UPDATE players SET tok=$1,rej=NULL WHERE pid=$2', [now, pid]); await pushCmd(pid, { t: 'state', s: JSON.stringify(st) }); log('setstate', pid, pl.name); break; }
    case 'snapnow': { if (!pl.data) return send(res, 400, { error: '這位玩家目前沒有存檔' }); await snap(pid, JSON.parse(pl.data), '手動'); log('snapnow', pid, pl.name); break; }
    case 'restore': { const r = (await q('SELECT data FROM snaps WHERE pid=$1 AND ts=$2', [pid, Number(b.ts) || 0]))[0]; if (!r) return send(res, 404, { error: '找不到這份快照' }); let st; try { st = JSON.parse(r.data); } catch { return send(res, 400, { error: '快照損毀' }); }
      if (pl.data) { try { await snap(pid, JSON.parse(pl.data), '還原前'); } catch {} }
      await storeState(pid, st); await q('UPDATE players SET tok=$1,rej=NULL WHERE pid=$2', [now, pid]); await pushCmd(pid, { t: 'state', s: JSON.stringify(st) }); log('restore', pid, pl.name + ' → ' + new Date(Number(b.ts)).toLocaleString()); break; }
    case 'delsnap': await q('DELETE FROM snaps WHERE pid=$1 AND ts=$2', [pid, Number(b.ts) || 0]); break;
    case 'trust': await q('UPDATE players SET trust=$1 WHERE pid=$2', [b.on ? 1 : 0, pid]); log(b.on ? 'trust' : 'untrust', pid, pl.name); break;
    case 'clearstrikes': await q('UPDATE players SET strikes=0,rej=NULL WHERE pid=$1', [pid]); break;
    case 'adm': { const on = b.on ? (Number(b.lv) === 2 ? 2 : 1) : 0; await q('UPDATE players SET adm=$1 WHERE pid=$2', [on, pid]); if (on) await q('UPDATE players SET tier=$1 WHERE pid=$2', [on === 2 ? '特約' : '管理員', pid]); log(on ? 'adm_grant' : 'adm_revoke', pid, pl.name + (on ? ' Lv' + on : '')); break; }
    case 'dep': {
      if (b.on) { const pm = cleanPerms(b.perms); if (!pl.acct) return send(res, 400, { error: '這位玩家還沒有註冊帳號，特約玩家要用帳號密碼登入後台，請他先註冊' }); await q('UPDATE players SET dep=1,perms=$1 WHERE pid=$2', [JSON.stringify(pm), pid]); log('dep_grant', pid, pl.name + ' ' + pm.join(',')); }
      else { await q('UPDATE players SET dep=0,perms=NULL WHERE pid=$1', [pid]); for (const [t, v] of deps) if (v.pid === pid) deps.delete(t); log('dep_revoke', pid, pl.name); }
      break; }
    case 'emset': { const n = Math.floor(Number(b.n)); if (!(n >= 0) || n > 1e12) return send(res, 400, { error: 'bad n' }); await pushCmd(pid, { t: 'emset', n }); log('emset', pid, n); break; }
    case 'note': await q('UPDATE players SET note=$1 WHERE pid=$2', [String(b.v || '').slice(0, 300), pid]); break;
    case 'reset': if (pl.data) { try { await snap(pid, JSON.parse(pl.data), '重設前'); } catch {} } await pushCmd(pid, { t: 'reset' }); log('reset', pid, pl.name); break;
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
    case 'resetpass': { let pw = String(b.pass || ''), gen = ''; if (!pl.acct) return send(res, 400, { error: '這位玩家沒有註冊帳號' }); if (!pw) { for (const x of crypto.randomBytes(10)) gen += FCAL[x % 32]; pw = gen; } const pe = pwErr(pw, pl.acct); if (pe) return send(res, 400, { error: pe }); await q('UPDATE players SET pwh=$1 WHERE pid=$2', [await hashPw(pw), pid]); log('resetpass', pid, pl.acct); return send(res, 200, { ok: 1, pass: gen }); }
    case 'clearacct': await q('UPDATE players SET acct=NULL,pwh=NULL WHERE pid=$1', [pid]); log('clearacct', pid, pl.acct || ''); break;
    case 'delete': await q('DELETE FROM chat WHERE a=$1 OR b=$1', [pid]); await q('DELETE FROM snaps WHERE pid=$1', [pid]); await q('DELETE FROM friends WHERE a=$1 OR b=$1', [pid]); await q('DELETE FROM players WHERE pid=$1', [pid]); log('delete', pid, pl.name); break;
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
    if (req.method === 'POST') {
      if (p === '/api/register') return await register(req, res);
      if (p === '/api/login') return await login(req, res);
      if (p === '/api/deputy/login') return await depLogin(req, res);
      if (p === '/api/passwd') return await passwd(req, res);
      if (p === '/api/friends') return await friendList(req, res);
      if (p === '/api/friend') return await friendAct(req, res);
      if (p === '/api/chat/list') return await chatList(req, res);
      if (p === '/api/chat/send') return await chatSend(req, res);
      if (p === '/api/xfer/offer') return await xferOffer(req, res);
      if (p === '/api/xfer/accept') return await xferAnswer(req, res, 'accept');
      if (p === '/api/xfer/reject') return await xferAnswer(req, res, 'reject');
      if (p === '/api/xfer/cancel') return await xferAnswer(req, res, 'cancel');
    }
    if (p.startsWith('/api/admin/')) return await admin(req, res, u);
    send(res, 404, { error: 'not found' });
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); }
}).listen(process.env.PORT || 10000, () => console.log('up'));
