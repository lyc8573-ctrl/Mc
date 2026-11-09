// 極簡資本 伺服器：零依賴（只用 Node 內建模組）。啟動：ADMIN_PASSWORD=你的密碼 node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (ADMIN_PASSWORD === 'admin1234') console.warn('⚠ 正在使用預設後台密碼，請設定環境變數 ADMIN_PASSWORD！');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { players: {}, codes: {}, events: [], settings: { maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25 }, log: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
db.settings = Object.assign({ maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25 }, db.settings);
let dirty = false;
const persist = () => { if (!dirty) return; dirty = false; fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), e => { if (!e) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {}); }); };
setInterval(persist, 3000); process.on('SIGINT', () => { dirty = true; persist(); setTimeout(() => process.exit(), 300); });
const touch = () => { dirty = true; };
const uid = (n = 8) => crypto.randomBytes(n).toString('hex');
const log = (m) => { db.log.unshift({ t: Date.now(), m }); db.log.length = Math.min(db.log.length, 500); touch(); };

// ---------- SSE ----------
const conns = new Map(); // playerId -> Set(res)
const online = id => conns.has(id) && conns.get(id).size > 0;
const sse = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const sendTo = (id, ev, data) => (conns.get(id) || []).forEach(r => sse(r, ev, data));
const broadcast = (ev, data) => conns.forEach(set => set.forEach(r => sse(r, ev, data)));
const now = () => Date.now();
const activeEvents = () => db.events.filter(e => !e.ended && e.start <= now() && e.end > now());
const pubEvents = () => db.events.filter(e => !e.ended && e.end > now()).map(e => ({ id: e.id, name: e.name, type: e.type, factor: e.factor, start: e.start, end: e.end }));
const pushEvents = () => broadcast('events', { now: now(), events: pubEvents() });

// ---------- 指令（發放獎勵）----------
const RANGE = [[0, 150], [150, 230], [230, 275], [275, 293], [293, 299], [299, 300]];
function mkCmd(b) {
  const c = { id: uid(6), type: b.type, msg: String(b.msg || '').slice(0, 80) };
  if (['money', 'setmoney', 'cores', 'rebirth'].includes(b.type)) { c.value = Number(b.value); if (!Number.isFinite(c.value)) throw 'value 不是數字'; if (c.type === 'setmoney' && c.value < 0) throw '金額不可為負'; }
  else if (b.type === 'buff') {
    const n = Math.min(Math.max(parseInt(b.count) || 1, 1), 500);
    if (b.id !== undefined && b.id !== '' && b.id !== null) { const i = parseInt(b.id); if (!(i >= 0 && i < 300)) throw 'Buff 編號需 0~299'; c.ids = Array(n).fill(i); }
    else { const r = RANGE[parseInt(b.rarity)]; if (!r) throw '稀有度需 0~5'; c.ids = Array.from({ length: n }, () => r[0] + Math.floor(Math.random() * (r[1] - r[0]))); }
  } else if (b.type !== 'reset') throw '未知類型';
  return c;
}
function queue(p, cmd) { (p.recent = p.recent || []).push({ id: cmd.id, t: now(), acked: false, money: cmd.type === 'money' || cmd.type === 'setmoney' ? Math.max(0, cmd.value) : 0, buffs: (cmd.ids || []).length, cores: cmd.type === 'cores' ? Math.max(0, cmd.value) : 0, rebirth: cmd.type === 'rebirth' ? Math.max(0, cmd.value) : 0 }); p.recent = p.recent.slice(-300); p.pending.push(cmd); if (p.pending.length > 200) p.pending.shift(); touch(); sendTo(p.id, 'cmd', cmd); }
const describe = c => ({ money: `金錢 ${c.value > 0 ? '+' : ''}${c.value}`, setmoney: `金錢設為 ${c.value}`, cores: `資本核心 ${c.value}`, rebirth: `重生 ${c.value}`, buff: `Buff x${(c.ids || []).length}`, reset: '重置進度' }[c.type]);

// ---------- 排程：活動開始/結束公告、撒錢 ----------
setInterval(() => {
  let changed = false;
  for (const e of db.events) {
    if (!e.ended && !e.startedNotified && now() >= e.start) { e.startedNotified = true; changed = true; broadcast('announce', { text: `🎉 活動開始：${e.name}`, style: 'event' }); }
    if (!e.ended && now() >= e.end) { e.ended = true; changed = true; broadcast('announce', { text: `活動結束：${e.name}`, style: 'info' }); }
    if (!e.ended && e.type === 'rain' && now() >= e.start && now() >= (e.nextTick || 0)) {
      e.nextTick = now() + e.interval * 1000;
      for (const id of conns.keys()) if (db.players[id] && online(id)) queue(db.players[id], mkCmd({ type: 'money', value: e.factor, msg: `💰 ${e.name}` }));
    }
  }
  if (changed) { touch(); pushEvents(); }
}, 1000);
setInterval(() => conns.forEach(s => s.forEach(r => r.write(': ping\n\n'))), 20000);


// ---------- 輕量防作弊：存檔合理性檢查 ----------
const NUM = (x, max = 1e100) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
const INT = (x, max = 1e15) => NUM(x, max) && Number.isInteger(x);
const rarityOf = id => id < 150 ? 0 : id < 230 ? 1 : id < 275 ? 2 : id < 293 ? 3 : id < 299 ? 4 : 5;
const BUCKET_CAP = 1e13, BUCKET_RATE = 5e12 / 3600; // 轉帳/運氣等無法驗證的額外收入額度（約每小時 5 兆）
const STOCK_PRICE_CAP = 5000;
function structural(s) { // 回傳 {fatal, reasons}
  const bad = (m) => ({ fatal: m, reasons: [] });
  if (!s || typeof s !== 'object' || !s.state || typeof s.state !== 'object') return bad('存檔格式錯誤');
  const st = s.state;
  if (!NUM(st.balance) || !NUM(st.bankDeposit || 0) || !NUM(st.bankLoan || 0)) return bad('金額數值異常');
  if (!Array.isArray(s.stocks || []) || (s.stocks || []).length > 30 || !(s.stocks || []).every(x => INT(x))) return bad('股票資料異常');
  if (!Array.isArray(s.companies || []) || (s.companies || []).length > 30 || !(s.companies || []).every(c => c && INT(c.level, 5000))) return bad('公司資料異常');
  st.bankDeposit = st.bankDeposit || 0; st.bankLoan = st.bankLoan || 0; st.upgrades = st.upgrades || { click: 0, company: 0, discount: 0 }; st.inventory = st.inventory || {}; st.equippedBuffs = st.equippedBuffs || [];
  const r = [];
  if (!INT(st.rebirths, 300) || !INT(st.capitalCores) || !INT(st.currentCardLevel, 30) || !INT(st.maxCardOwnedLevel, 30) || !NUM(st.baseClick, 1e6)) return bad('進度數值異常');
  if (st.currentCardLevel > st.maxCardOwnedLevel) r.push('目前卡片等級高於已擁有最高等級');
  for (const k of ['click', 'company', 'discount']) if (!INT(st.upgrades[k], 1e6)) return bad('天賦數值異常');
  if (typeof st.inventory !== 'object' || !Object.entries(st.inventory).every(([k, v]) => INT(+k, 299) && INT(v, 1e7))) return bad('背包資料異常');
  if (!Array.isArray(st.equippedBuffs) || st.equippedBuffs.length > 5) r.push('裝備 Buff 欄位數異常');
  else for (const b of st.equippedBuffs) {
    const ri = b && INT(b.id, 299) ? rarityOf(b.id) : -1, max = ri < 0 ? 0 : ri === 5 ? 38 : 3 * ri + 4, min = ri === 5 ? 24 : 2 + 2 * Math.max(ri, 0);
    if (ri < 0 || b.rarityIndex !== ri || !Number.isFinite(b.effect) || b.effect > max || b.effect < min) { r.push(`Buff 數值不合法（#${b && b.id} 倍率 ${b && b.effect}）`); break; }
  }
  return { reasons: r };
}
function evMult() { let click = 1, income = 1; activeEvents().forEach(e => { if (e.type === 'click' || e.type === 'all') click *= e.factor; if (e.type === 'income' || e.type === 'all') income *= e.factor; }); return { click, income }; }
function vet(p, s) {
  const sv = structural(s); if (sv.fatal) return sv; if (db.settings.ac === 'off') return { reasons: [] };
  const st = s.state, r = sv.reasons, t = now(), old = p.save && p.save.state;
  const w = st.balance + st.bankDeposit;
  if (!old) { if (w > 1e12) r.push(`新帳號帶入高額存檔 $${Math.floor(w)}`); return { reasons: r }; }
  const cps = db.settings.maxCps || 25, ev = evMult();
  const dt = Math.min(Math.max((t - (p.lastSaveAt || t - 5000)) / 1000, 1), 3600);
  // 收入上限一律用「上一次已接受的存檔」推算，避免玩家用假等級撐高自己的上限
  const ou = Object.assign({ click: 0, company: 0, discount: 0 }, old.upgrades), oCards = old.currentCardLevel || 0, oReb = Math.min(old.rebirths || 0, 300);
  const mult = Math.floor((old.equippedBuffs || []).reduce((a, b) => a * ((b && b.effect) || 1), 1)) || 1;
  const click = Math.floor((old.baseClick || 1) * (1 + 0.75 * oCards) * mult * Math.pow(2, oReb) * (1 + ou.click)) * ev.click;
  let pas = 0; (p.save.companies || []).forEach((c, i) => pas += ((c && c.level) || 0) * Math.floor(Math.floor(10 * Math.pow(1.45, i)) * 0.75 * (1 + 0.375 * oCards) * (1 + ou.company)));
  const earn = (click * cps + pas * mult * ev.income) * dt * 3;
  const oldB = old.balance || 0, oldD = old.bankDeposit || 0, oldW = oldB + oldD;
  const g = { money: 0, buffs: 0, cores: 0, rebirth: 0 };
  (p.recent || []).forEach(x => { if (!x.acked || t - x.t < 120000) for (const k in g) g[k] += x[k]; });
  const oS = (p.save.stocks || []), nS = (s.stocks || []), oC = (p.save.companies || []), nC = (s.companies || []);
  let sold = 0, bought = 0, lv = 0;
  nS.forEach((n, i) => { const o = oS[i] || 0; if (n < o) sold += (o - n) * STOCK_PRICE_CAP; else bought += n - o; });
  nC.forEach((c, i) => lv += Math.max(0, c.level - ((oC[i] && oC[i].level) || 0)));
  const loanUp = Math.max(0, st.bankLoan - (old.bankLoan || 0));
  const cash = oldW + earn + g.money + sold + loanUp;
  const allowed = oldW * 3 + earn + 1e7 + sold + loanUp + g.money + oldD * 0.0003 * dt;
  const excess = w - allowed;
  if (excess > 0) {
    p.bucket = Math.min(BUCKET_CAP, (p.bucket === undefined ? BUCKET_CAP : p.bucket) + (t - (p.bucketT || t)) / 1000 * BUCKET_RATE); p.bucketT = t;
    if (excess <= p.bucket) p.bucket -= excess; else r.push(`資產暴增：${Math.floor(oldW)} → ${Math.floor(w)}（合理上限約 ${Math.floor(allowed)}）`);
  }
  if (bought > cash) r.push(`股票數量暴增（+${bought} 股，現金不足）`);
  if (lv * 300 > cash) r.push(`公司等級暴增（+${lv} 級，現金不足）`);
  const cnt = x => Object.values(x.inventory || {}).reduce((a, b) => a + b, 0) + (x.equippedBuffs || []).length;
  if (cnt(st) - cnt(old) > Math.floor(cash / 1e11) + g.buffs) r.push(`Buff 數量暴增（+${cnt(st) - cnt(old)}）`);
  if (st.capitalCores - (old.capitalCores || 0) > Math.floor((oldB + earn + g.money) / 1e16) + g.cores) r.push(`資本核心暴增（+${st.capitalCores - (old.capitalCores || 0)}）`);
  if (st.rebirths - (old.rebirths || 0) > 2 + g.rebirth) r.push(`重生次數暴增（+${st.rebirths - (old.rebirths || 0)}）`);
  if (st.maxCardOwnedLevel > (old.maxCardOwnedLevel || 0) && Math.floor(100 * Math.pow(10, st.maxCardOwnedLevel - 1) * Math.pow(0.9, st.upgrades.discount)) > cash) r.push(`卡片等級暴增（→ ${st.maxCardOwnedLevel}）`);
  return { reasons: r };
}

// ---------- 工具 ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, no) => { let s = ''; req.on('data', d => { s += d; if (s.length > 3e6) { req.destroy(); no('too big'); } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
const adminTokens = new Map(); const fails = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const playerByToken = t => Object.values(db.players).find(p => p.token === t);
const summary = p => { const s = (p.save && p.save.state) || {}; return { id: p.id, name: p.name, online: online(p.id), balance: Math.floor(s.balance || 0), bank: Math.floor(s.bankDeposit || 0), loan: Math.floor(s.bankLoan || 0), rebirths: s.rebirths || 0, cores: s.capitalCores || 0, buffs: Object.values(s.inventory || {}).reduce((a, b) => a + b, 0), lastSeen: p.lastSeen, banned: p.banned, banReason: p.banReason, pending: p.pending.length, strikes: p.strikes || 0, flags: p.flags || [] }; };

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  // ---- 玩家 ----
  if (p === '/api/status') return json(res, 200, { maintenance: db.settings.maintenance, motd: db.settings.motd, online: [...conns.keys()].length });
  if (p === '/api/login' && m === 'POST') {
    const b = await body(req); const name = String(b.name || '').trim().slice(0, 16);
    if (!name) return json(res, 400, { error: '請輸入名稱' });
    if (db.settings.maintenance) return json(res, 503, { error: '伺服器維護中：' + (db.settings.motd || '請稍後再試') });
    let pl = Object.values(db.players).find(x => x.name === name);
    if (pl) { if (pl.token !== b.key) return json(res, 409, { error: '此名稱已被使用，若是你的帳號請輸入登入金鑰' }); }
    else { pl = db.players[uid(4)] = { name, token: uid(12), save: null, created: now(), lastSeen: now(), banned: false, pending: [], redeemed: [] }; pl.id = Object.keys(db.players).find(k => db.players[k] === pl); log(`新玩家註冊：${name}`); }
    if (pl.banned) return json(res, 403, { error: '帳號已被封鎖：' + (pl.banReason || '') });
    pl.lastSeen = now(); touch();
    return json(res, 200, { name: pl.name, key: pl.token, hasSave: !!pl.save });
  }
  const pl = playerByToken(req.headers['x-token'] || url.searchParams.get('key'));
  if (p.startsWith('/api/') && !p.startsWith('/api/admin')) {
    if (!pl) return json(res, 401, { error: '未登入' });
    if (pl.banned) return json(res, 403, { error: '帳號已被封鎖' });
    if (p === '/api/save' && m === 'GET') return json(res, 200, { save: pl.save });
    if (p === '/api/save' && m === 'POST') {
      const b = await body(req); const s = b.save, v = vet(pl, s);
      if (v.fatal) { pl.strikes = (pl.strikes || 0) + 1; touch(); return json(res, 422, { error: '偵測到異常數據：' + v.fatal }); }
      let reject = false;
      if (v.reasons.length) {
        pl.strikes = (pl.strikes || 0) + 1; pl.flags = pl.flags || []; pl.flags.unshift({ t: now(), r: v.reasons }); pl.flags.length = Math.min(pl.flags.length, 20);
        if (now() - (pl.lastFlagLog || 0) > 60000) { pl.lastFlagLog = now(); log(`⚠ 可疑存檔 ${pl.name}：${v.reasons.join('；')}`); }
        if (db.settings.autoBan > 0 && pl.strikes >= db.settings.autoBan) { pl.banned = true; pl.banReason = '系統偵測作弊'; sendTo(pl.id, 'kick', { reason: '你已被封鎖：系統偵測作弊' }); log(`🚫 自動封鎖 ${pl.name}（可疑 ${pl.strikes} 次）`); }
        reject = db.settings.ac === 'reject';
      }
      pl.lastSeen = now(); touch();
      if (reject) return json(res, 422, { error: '偵測到異常數據，已還原為伺服器進度' });
      pl.save = s; pl.lastSaveAt = now(); return json(res, 200, { ok: true });
    }
    if (p === '/api/ack' && m === 'POST') { const b = await body(req); pl.pending = pl.pending.filter(c => !(b.ids || []).includes(c.id)); (pl.recent || []).forEach(r => { if ((b.ids || []).includes(r.id)) { r.acked = true; r.t = now(); } }); touch(); return json(res, 200, { ok: true }); }
    if (p === '/api/redeem' && m === 'POST') {
      const b = await body(req); const code = String(b.code || '').trim().toUpperCase(); const c = db.codes[code];
      if (!c || (c.expires && c.expires < now())) return json(res, 404, { error: '兌換碼無效或已過期' });
      if (c.uses >= c.maxUses) return json(res, 410, { error: '兌換碼已被領完' });
      if (pl.redeemed.includes(code)) return json(res, 409, { error: '你已兌換過此代碼' });
      c.uses++; pl.redeemed.push(code); queue(pl, Object.assign(mkCmd(c.cmd), { msg: `🎁 兌換成功：${code}` })); log(`${pl.name} 兌換 ${code}`);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!conns.has(pl.id)) conns.set(pl.id, new Set()); conns.get(pl.id).add(res);
      sse(res, 'hello', { now: now(), events: pubEvents(), motd: db.settings.motd, maintenance: db.settings.maintenance });
      pl.pending.forEach(c => sse(res, 'cmd', c));
      req.on('close', () => { const s = conns.get(pl.id); if (s) { s.delete(res); if (!s.size) conns.delete(pl.id); } pl.lastSeen = now(); touch(); });
      return;
    }
    return json(res, 404, { error: 'not found' });
  }
  // ---- 後台 ----
  if (p === '/admin/api/login' && m === 'POST') {
    const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, t: 0 };
    if (f.n >= 5 && now() - f.t < 60000) return json(res, 429, { error: '嘗試過多，請 1 分鐘後再試' });
    const b = await body(req);
    if (b.password !== ADMIN_PASSWORD) { fails.set(ip, { n: f.n + 1, t: now() }); return json(res, 401, { error: '密碼錯誤' }); }
    fails.delete(ip); const t = uid(16); adminTokens.set(t, now() + 12 * 3600e3); return json(res, 200, { token: t });
  }
  if (p.startsWith('/admin/api/')) {
    const exp = adminTokens.get(req.headers['x-admin']); if (!exp || exp < now()) return json(res, 401, { error: '請重新登入' });
    const b = m === 'POST' ? await body(req) : {}; let r;
    try {
      if (p === '/admin/api/overview') {
        const all = Object.values(db.players).map(summary);
        return json(res, 200, { flagged: all.filter(x => x.strikes).length, total: all.length, online: all.filter(x => x.online).length, money: all.reduce((a, x) => a + x.balance, 0), settings: db.settings, events: db.events.filter(e => !e.ended).length, top: all.sort((a, b) => b.balance - a.balance).slice(0, 10) });
      }
      if (p === '/admin/api/players') { const q = (url.searchParams.get('q') || '').toLowerCase(); return json(res, 200, Object.values(db.players).filter(x => x.name.toLowerCase().includes(q)).map(summary).sort((a, b) => b.online - a.online || b.balance - a.balance)); }
      if ((r = p.match(/^\/admin\/api\/player\/(\w+)(?:\/(\w+))?$/))) {
        const t = db.players[r[1]]; if (!t) return json(res, 404, { error: '找不到玩家' }); const act = r[2];
        if (m === 'DELETE') { sendTo(t.id, 'kick', { reason: '帳號已被刪除' }); delete db.players[t.id]; log(`刪除玩家 ${t.name}`); touch(); return json(res, 200, { ok: true }); }
        if (!act) return json(res, 200, Object.assign(summary(t), { key: t.token, created: t.created, save: t.save }));
        if (act === 'cmd') { const c = mkCmd(b); queue(t, c); log(`對 ${t.name} 執行：${describe(c)}`); return json(res, 200, { ok: true, online: online(t.id) }); }
        if (act === 'ban') { t.banned = !!b.banned; t.banReason = String(b.reason || ''); if (t.banned) sendTo(t.id, 'kick', { reason: '你已被封鎖：' + t.banReason }); log(`${t.banned ? '封鎖' : '解封'} ${t.name} ${t.banReason}`); touch(); return json(res, 200, { ok: true }); }
        if (act === 'clearflags') { t.strikes = 0; t.flags = []; touch(); return json(res, 200, { ok: true }); }
        if (act === 'kick') { sendTo(t.id, 'kick', { reason: String(b.reason || '你已被管理員踢出') }); log(`踢出 ${t.name}`); return json(res, 200, { ok: true }); }
        if (act === 'rename') { const n = String(b.name || '').trim().slice(0, 16); if (!n || Object.values(db.players).some(x => x.name === n)) throw '名稱無效或重複'; log(`改名 ${t.name} → ${n}`); t.name = n; touch(); return json(res, 200, { ok: true }); }
      }
      if (p === '/admin/api/gift') {
        const targets = b.target === 'all' ? Object.values(db.players) : Object.values(db.players).filter(x => online(x.id));
        const base = mkCmd(b); targets.forEach(t => queue(t, Object.assign({}, base, { id: uid(6) }))); log(`${b.target === 'all' ? '全服' : '線上'}發放：${describe(base)}（${targets.length} 人）`);
        return json(res, 200, { ok: true, count: targets.length });
      }
      if (p === '/admin/api/announce') { const text = String(b.text || '').slice(0, 200); if (!text) throw '內容空白'; broadcast('announce', { text, style: b.style || 'info' }); log(`公告：${text}`); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/events' && m === 'GET') return json(res, 200, db.events.slice().reverse().slice(0, 100));
      if (p === '/admin/api/events' && m === 'POST') {
        if (!['click', 'income', 'all', 'rain'].includes(b.type)) throw '活動類型錯誤';
        const factor = Number(b.factor), mins = Number(b.minutes), delay = Number(b.delayMinutes) || 0;
        if (!(factor > 0) || !(mins > 0)) throw '倍率/時間需為正數';
        const start = now() + delay * 60000, e = { id: uid(4), name: String(b.name || '限時活動').slice(0, 30), type: b.type, factor, interval: Math.max(5, Number(b.interval) || 30), start, end: start + mins * 60000, ended: false };
        db.events.push(e); log(`建立活動：${e.name}（${e.type} x${e.factor}，${mins} 分鐘）`); touch(); pushEvents();
        if (delay > 0) broadcast('announce', { text: `📣 活動預告：${e.name}，${delay} 分鐘後開始！`, style: 'event' });
        return json(res, 200, e);
      }
      if ((r = p.match(/^\/admin\/api\/events\/(\w+)\/end$/)) && m === 'POST') { const e = db.events.find(x => x.id === r[1]); if (e) { e.ended = true; log(`提前結束活動 ${e.name}`); touch(); pushEvents(); broadcast('announce', { text: `活動結束：${e.name}`, style: 'info' }); } return json(res, 200, { ok: true }); }
      if (p === '/admin/api/codes' && m === 'GET') return json(res, 200, db.codes);
      if (p === '/admin/api/codes' && m === 'POST') {
        const code = String(b.code || uid(3)).trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw '代碼需 3~24 位英數字';
        mkCmd(b); db.codes[code] = { cmd: { type: b.type, value: b.value, id: b.id, rarity: b.rarity, count: b.count }, maxUses: Math.max(1, parseInt(b.maxUses) || 1), uses: 0, expires: b.expireMinutes ? now() + b.expireMinutes * 60000 : 0 };
        log(`建立兌換碼 ${code}`); touch(); return json(res, 200, { code });
      }
      if ((r = p.match(/^\/admin\/api\/codes\/([\w-]+)$/)) && m === 'DELETE') { delete db.codes[r[1]]; touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/settings' && m === 'POST') {
        if (b.maintenance !== undefined) { db.settings.maintenance = !!b.maintenance; if (b.maintenance) conns.forEach((_, id) => sendTo(id, 'kick', { reason: '伺服器進入維護：' + (b.motd || db.settings.motd) })); }
        if (b.motd !== undefined) db.settings.motd = String(b.motd).slice(0, 100);
        if (['off', 'flag', 'reject'].includes(b.ac)) db.settings.ac = b.ac;
        if (b.autoBan !== undefined) db.settings.autoBan = Math.max(0, parseInt(b.autoBan) || 0);
        if (b.maxCps !== undefined) db.settings.maxCps = Math.min(200, Math.max(1, Number(b.maxCps) || 25)); log(`設定更新 maintenance=${db.settings.maintenance}`); touch(); return json(res, 200, db.settings);
      }
      if (p === '/admin/api/log') return json(res, 200, db.log);
      if (p === '/admin/api/backup') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="backup.json"' }); return res.end(JSON.stringify(db)); }
    } catch (e) { return json(res, 400, { error: String(e) }); }
  }
  json(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/api/')) return api(req, res, url).catch(e => { console.error(e); json(res, 500, { error: 'server error' }); });
  const f = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : url.pathname.slice(1);
  if (!['index.html', 'admin.html', 'online.js'].includes(f)) { res.writeHead(404); return res.end('Not found'); }
  const fp = path.join(__dirname, f);
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT, () => console.log(`極簡資本伺服器：http://localhost:${PORT}　後台：http://localhost:${PORT}/admin`));
