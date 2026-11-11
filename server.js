// 極簡資本 伺服器：零依賴（只用 Node 內建模組）。啟動：ADMIN_PASSWORD=你的密碼 node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (ADMIN_PASSWORD === 'admin1234') console.warn('⚠ 正在使用預設後台密碼，請設定環境變數 ADMIN_PASSWORD！');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { players: {}, codes: {}, events: [], settings: { maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25, xferMinFriendMin: 5, xferMax: 0, xferDaily: 0, bucketHour: 1e11 }, log: [] };

// ---------- GitHub 雲端備份（免費方案的硬碟會在重啟時清空，用私人 GitHub 倉庫保存資料）----------
// 需要環境變數：GH_TOKEN（細粒度 Token，Contents 讀寫）、GH_REPO（如 帳號/mc-data）。選用：GH_PATH、GH_BRANCH、GH_PUSH_SEC（預設 120）
const cp = require('child_process');
const GH = { token: process.env.GH_TOKEN, repo: process.env.GH_REPO, path: process.env.GH_PATH || 'db.json', branch: process.env.GH_BRANCH || 'main', api: process.env.GH_API || 'https://api.github.com' };
const GH_ON = !!(GH.token && GH.repo), GH_PUSH_SEC = Math.max(30, Number(process.env.GH_PUSH_SEC) || 120);
const ghState = { last: 0, err: '', busy: false, pulled: '' };
let ghDirty = false;
async function ghPushImpl(token, repo, path, branch, text, api) { // 只用 fetch；也會被序列化後在子行程使用
  const call = async (method, p, body) => { const r = await fetch(api + '/repos/' + repo + p, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mc-server', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(method + ' ' + p + ' → ' + r.status + ' ' + (j.message || '')); return j; };
  const blob = await call('POST', '/git/blobs', { content: Buffer.from(text).toString('base64'), encoding: 'base64' });
  const tree = await call('POST', '/git/trees', { tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] });
  const commit = await call('POST', '/git/commits', { message: 'backup ' + new Date().toISOString(), tree: tree.sha, parents: [] }); // 無父提交：只保留最新一份，倉庫不會越長越大
  try { await call('PATCH', '/git/refs/heads/' + branch, { sha: commit.sha, force: true }); } catch (e) { await call('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }); }
}
const GH_PULL = `
const fs = require('fs'); const [repo, path, branch, file, api] = process.argv.slice(1);
const H = { Authorization: 'Bearer ' + process.env.GH_TOKEN, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mc-server' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => { let last = '';
  for (let i = 0; i < 4; i++) { try {
    const a = await fetch(api + '/repos/' + repo, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, H) });
    if (a.status === 404 || a.status === 401 || a.status === 403) { console.log('FATAL 無法存取倉庫 ' + repo + '（' + a.status + '）：請確認 GH_REPO 名稱與 Token 權限'); process.exit(3); }
    if (!a.ok) throw new Error('repo ' + a.status);
    const r = await fetch(api + '/repos/' + repo + '/contents/' + path + '?ref=' + branch, { headers: Object.assign({ Accept: 'application/vnd.github.raw+json' }, H) });
    if (r.status === 404) { console.log('NOREMOTE'); return; }
    if (!r.ok) throw new Error('contents ' + r.status);
    const txt = await r.text(), rem = JSON.parse(txt); let loc = null; try { loc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const rs = (rem.meta && rem.meta.savedAt) || 0, ls = (loc && loc.meta && loc.meta.savedAt) || 0;
    if (!loc || rs >= ls) { fs.writeFileSync(file, txt); console.log('PULLED ' + Object.keys(rem.players || {}).length); } else console.log('LOCAL_NEWER');
    return; } catch (e) { last = e.message; await sleep(2000 * (i + 1)); } }
  console.log('FATAL 讀取 GitHub 備份失敗：' + last); process.exit(2); })();`;
if (GH_ON) {
  try { const out = cp.execFileSync(process.execPath, ['-e', GH_PULL, GH.repo, GH.path, GH.branch, DB_FILE, GH.api], { env: process.env, timeout: 90000 }).toString().trim(); ghState.pulled = out; console.log('GitHub 備份：' + out); }
  catch (e) { console.error(String((e.stdout || '') + (e.stderr || '') || e.message)); console.error('✖ 無法確認 GitHub 上的備份，為避免用空資料覆蓋，伺服器不啟動。請檢查 GH_TOKEN / GH_REPO。'); process.exit(1); }
}
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
db.bans = db.bans || { devices: {}, ips: {} }; db.autoAnn = db.autoAnn || []; db.hist = db.hist || [];
db.settings = Object.assign({ maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25, xferMinFriendMin: 5, xferMax: 0, xferDaily: 0, bucketHour: 1e11 }, db.settings);
db.meta = db.meta || { created: Date.now(), boots: 0 }; db.meta.boots++;
console.log(`已載入 ${Object.keys(db.players).length} 位玩家；資料目錄：${DATA_DIR}；第 ${db.meta.boots} 次啟動`);
const PERSIST_WARN = !!process.env.RENDER && !String(DATA_DIR).startsWith('/var/data') && !GH_ON;
if (PERSIST_WARN) console.warn('⚠ 偵測到在 Render 上但沒有持久硬碟，也沒有設定 GitHub 備份（GH_TOKEN / GH_REPO）：重啟或休眠後所有玩家資料與帳號會消失！');
let dirty = false;
const persist = () => { if (!dirty) return; dirty = false; fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), e => { if (!e) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {}); }); };
async function ghPush(force) {
  if (!GH_ON || ghState.busy) return; if (!force && !ghDirty) return; ghState.busy = true; ghDirty = false;
  try { db.meta.savedAt = Date.now(); await ghPushImpl(GH.token, GH.repo, GH.path, GH.branch, JSON.stringify(db), GH.api); ghState.last = Date.now(); ghState.err = ''; }
  catch (e) { ghDirty = true; ghState.err = e.message; console.error('GitHub 備份失敗：', e.message); }
  ghState.busy = false;
}
setInterval(() => { if (GH_ON && ghDirty && Date.now() - ghState.last > GH_PUSH_SEC * 1000) ghPush(); }, 10000);
setInterval(persist, 3000); const flushExit = () => {
  try { db.meta.savedAt = Date.now(); const txt = JSON.stringify(db); fs.writeFileSync(DB_FILE + '.tmp', txt); fs.renameSync(DB_FILE + '.tmp', DB_FILE);
    if (GH_ON) { const code = `const f = ${ghPushImpl.toString()}; const a = process.argv.slice(1); f(a[0], a[1], a[2], a[3], require('fs').readFileSync(0, 'utf8'), a[4]).then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });`; cp.execFileSync(process.execPath, ['-e', code, GH.token, GH.repo, GH.path, GH.branch, GH.api], { input: txt, timeout: 20000, stdio: ['pipe', 'inherit', 'inherit'] }); console.log('已在關閉前備份到 GitHub'); } }
  catch (e) { console.error('關閉前存檔/備份失敗', e.message); } process.exit(0); };
process.on('SIGINT', flushExit); process.on('SIGTERM', flushExit);
const touch = () => { dirty = true; ghDirty = true; };
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
const pubEvents = () => db.events.filter(e => !e.ended && e.end > now()).map(e => ({ id: e.id, name: e.name, type: e.type, factor: e.factor, start: e.start, end: e.end, n: e.n, left: e.type === 'packet' ? e.n - (e.claimed || []).length : undefined }));
const pushEvents = () => broadcast('events', { now: now(), events: pubEvents() });

// ---------- 指令（發放獎勵）----------
const RANGE = [[0, 150], [150, 230], [230, 275], [275, 293], [293, 299], [299, 300]];
function mkCmd(b) {
  const c = { id: uid(6), type: b.type, msg: String(b.msg || '').slice(0, 80) };
  if (b.type === 'card') { c.value = parseInt(b.value); if (!(c.value >= 0 && c.value <= 29)) throw '卡片等級需為 0~29'; }
  else if (['money', 'setmoney', 'cores', 'rebirth'].includes(b.type)) { c.value = Number(b.value); if (!Number.isFinite(c.value)) throw 'value 不是數字'; if (c.type === 'setmoney' && c.value < 0) throw '金額不可為負'; }
  else if (b.type === 'buff') {
    const n = Math.min(Math.max(parseInt(b.count) || 1, 1), 500);
    if (b.id !== undefined && b.id !== '' && b.id !== null) { const i = parseInt(b.id); if (!(i >= 0 && i < 300)) throw 'Buff 編號需 0~299'; c.ids = Array(n).fill(i); }
    else { const r = RANGE[parseInt(b.rarity)]; if (!r) throw '稀有度需 0~5'; c.ids = Array.from({ length: n }, () => r[0] + Math.floor(Math.random() * (r[1] - r[0]))); }
  } else if (b.type === 'msg') { if (!c.msg) throw '訊息不可空白'; } else if (b.type !== 'reset') throw '未知類型';
  return c;
}
function queue(p, cmd) { (p.recent = p.recent || []).push({ id: cmd.id, t: now(), acked: false, money: cmd.type === 'money' || cmd.type === 'setmoney' ? Math.max(0, cmd.value) : 0, buffs: (cmd.ids || []).length, cores: cmd.type === 'cores' ? Math.max(0, cmd.value) : 0, rebirth: cmd.type === 'rebirth' ? Math.max(0, cmd.value) : 0, card: cmd.type === 'card' ? cmd.value : 0 }); p.recent = p.recent.slice(-300); p.pending.push(cmd); if (p.pending.length > 200) p.pending.shift(); touch(); sendTo(p.id, 'cmd', cmd); }
const describe = c => ({ money: `金錢 ${c.value > 0 ? '+' : ''}${c.value}`, setmoney: `金錢設為 ${c.value}`, cores: `資本核心 ${c.value}`, rebirth: `重生 ${c.value}`, buff: `Buff x${(c.ids || []).length}`, reset: '重置進度', msg: `私訊「${c.msg}」`, card: `卡片設為 ${c.value} 級` }[c.type]);


// ---------- 活動引擎 ----------
const PRIZE_TYPES = ['droprain', 'lottery', 'login', 'packet', 'contest'];
const MONEYISH = ['money', 'cores'];
function prizeCmd(e, scale = 1, msg) {
  const pz = Object.assign({}, e.prize, { msg: msg || (e.prize && e.prize.msg) || e.name });
  if (scale !== 1) { if (MONEYISH.includes(pz.type)) pz.value = Math.ceil(Number(pz.value) * scale); if (pz.type === 'buff') pz.count = Math.max(1, Math.ceil((parseInt(pz.count) || 1) * scale)); }
  return mkCmd(pz);
}
const onlinePlayers = () => [...conns.keys()].map(id => db.players[id]).filter(Boolean);
const wealthOf = p => { const st = (p.save && p.save.state) || {}; return (st.balance || 0) + (st.bankDeposit || 0); };
function giveLogin(e, pl) { e.claimed = e.claimed || []; if (e.claimed.includes(pl.id)) return; e.claimed.push(pl.id); queue(pl, prizeCmd(e, 1, `🎁 ${e.name}`)); }
function shockMarket(f) { market.p.forEach((p, i) => { market.p[i] = Math.min(1e9, Math.max(1, p * f)); market.h[i][49] = market.p[i]; }); touch(); broadcast('market', mktFull()); }
function onStart(e) {
  if (e.type === 'market') { shockMarket(e.factor); broadcast('announce', { text: e.factor >= 1 ? `📈 ${e.name}：全部股票 x${e.factor}！` : `📉 ${e.name}：全部股票 x${e.factor}！`, style: 'event' }); }
  if (e.type === 'login') onlinePlayers().forEach(p => giveLogin(e, p));
  if (e.type === 'packet') { e.claimed = []; broadcast('packet', { id: e.id, name: e.name, left: e.n }); }
  if (e.type === 'contest') { e.base = {}; Object.values(db.players).forEach(p => { if (p.save) e.base[p.id] = wealthOf(p); }); }
}
function onEnd(e) {
  if (e.type === 'market' && e.revert) { shockMarket(1 / e.factor); broadcast('announce', { text: `📊 ${e.name} 結束，股價回復`, style: 'info' }); }
  if (e.type === 'lottery') {
    const pool = onlinePlayers().sort(() => Math.random() - 0.5).slice(0, e.n);
    if (!pool.length) return broadcast('announce', { text: `🎰 ${e.name}：目前無人在線，未開獎`, style: 'info' });
    pool.forEach(p => queue(p, prizeCmd(e, 1, `🎰 恭喜中獎：${e.name}`)));
    broadcast('announce', { text: `🎰 ${e.name} 開獎！得主：${pool.map(p => p.name).join('、')}`, style: 'event' }); log(`抽獎 ${e.name} 得主：${pool.map(p => p.name).join('、')}`);
  }
  if (e.type === 'contest') {
    const rank = Object.values(db.players).filter(p => p.save && !isBanned(p)).map(p => ({ p, g: wealthOf(p) - (e.base[p.id] || 0) })).filter(x => x.g > 0).sort((a, b) => b.g - a.g).slice(0, Math.min(e.n, 10));
    rank.forEach((x, i) => queue(x.p, prizeCmd(e, [1, 0.5, 0.25][i] || 0.1, `🏆 ${e.name} 第 ${i + 1} 名獎勵`)));
    broadcast('announce', { text: rank.length ? `🏆 ${e.name} 結果：${rank.slice(0, 3).map((x, i) => `${i + 1}.${x.p.name}`).join(' ')}` : `🏆 ${e.name} 結束，無人上榜`, style: 'event' }); log(`競賽 ${e.name} 結果：${rank.map(x => x.p.name).join('、')}`);
  }
}
function endEvent(e, manual) {
  if (e.ended) return; e.ended = true; try { onEnd(e); } catch (err) { console.error(err); }
  broadcast('announce', { text: `活動結束：${e.name}`, style: 'info' });
  if (!manual && e.repeat > 0) { let st = e.start + e.repeat * 60000; while (st + (e.end - e.start) <= now()) st += e.repeat * 60000; const c = Object.assign({}, e, { id: uid(4), start: st, end: st + (e.end - e.start), ended: false, startedNotified: false, claimed: [], base: undefined, nextTick: 0 }); db.events.push(c); log(`重複活動已排程：${c.name}（${new Date(st).toLocaleString('zh-TW')}）`); }
  touch(); pushEvents();
}

// ---------- 排程：活動開始/結束公告、撒錢 ----------
setInterval(() => {
  let changed = false;
  for (const e of db.events) {
    if (!e.ended && !e.startedNotified && now() >= e.start) { e.startedNotified = true; changed = true; broadcast('announce', { text: `🎉 活動開始：${e.name}`, style: 'event' }); try { onStart(e); } catch (err) { console.error(err); } }
    if (!e.ended && now() >= e.end) { endEvent(e, false); changed = true; }
    if (!e.ended && e.type === 'droprain' && now() >= e.start && now() >= (e.nextTick || 0)) { e.nextTick = now() + e.interval * 1000; onlinePlayers().forEach(p => queue(p, prizeCmd(e, 1, `🎁 ${e.name}`))); }
    if (!e.ended && e.type === 'rain' && now() >= e.start && now() >= (e.nextTick || 0)) {
      e.nextTick = now() + e.interval * 1000;
      for (const id of conns.keys()) if (db.players[id] && online(id)) queue(db.players[id], mkCmd({ type: 'money', value: e.factor, msg: `💰 ${e.name}` }));
    }
  }
  if (changed) { touch(); pushEvents(); }
}, 1000);
setInterval(() => conns.forEach(s => s.forEach(r => r.write(': ping\n\n'))), 20000);
setInterval(() => {
  db.autoAnn.forEach(a => { if (now() >= a.next) { a.next = now() + a.every * 60000; broadcast('announce', { text: a.text, style: a.style }); touch(); } });
}, 5000);
setInterval(() => { db.hist.push([now(), conns.size]); if (db.hist.length > 1440) db.hist.shift(); touch(); }, 60000);



// ---------- 帳號密碼（玩家自訂，換裝置或被登出時用名稱+密碼登入）----------
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const setPw = (p, pw) => { p.salt = uid(8); p.pwHash = hashPw(pw, p.salt); touch(); };
const checkPw = (p, pw) => { if (!p.pwHash || !pw) return false; try { return crypto.timingSafeEqual(Buffer.from(hashPw(pw, p.salt), 'hex'), Buffer.from(p.pwHash, 'hex')); } catch { return false; } };
const loginFails = new Map();
// ---------- 封鎖系統（帳號 + 裝置 + IP + 同裝置小號）----------
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const cookieDev = req => (/(?:^|;\s*)mcdev=(\w+)/.exec(req.headers.cookie || '') || [])[1];
const livE = e => e && (!e.exp || e.exp > now());
const banHit = (dev, ip) => (dev && livE(db.bans.devices[dev]) && db.bans.devices[dev]) || (ip && livE(db.bans.ips[ip]) && db.bans.ips[ip]) || null;
const isBanned = p => { if (!p.banned) return false; if (p.banUntil && p.banUntil < now()) { p.banned = false; touch(); return false; } return true; };
function kick(id, reason) { sendTo(id, 'kick', { reason }); (conns.get(id) || []).forEach(r => { try { r.end(); } catch {} }); }
function banPlayer(t, reason, hours, ipHours, alts) {
  const exp = hours > 0 ? now() + hours * 3600e3 : 0, set = new Set([t]);
  if (alts) Object.values(db.players).forEach(x => { if (x !== t && (x.devs || []).some(d => (t.devs || []).includes(d))) set.add(x); });
  set.forEach(x => { x.banned = true; x.banUntil = exp; x.banReason = reason + (x !== t ? `（與 ${t.name} 同裝置）` : ''); kick(x.id, '你已被封鎖：' + x.banReason); });
  (t.devs || []).forEach(d => db.bans.devices[d] = { reason, t: now(), exp, name: t.name, by: t.id });
  if (ipHours > 0) (t.ips || []).forEach(ip => db.bans.ips[ip] = { reason, t: now(), exp: now() + ipHours * 3600e3, name: t.name, by: t.id });
  log(`🚫 封鎖 ${[...set].map(x => x.name).join('、')}（${reason}｜${hours > 0 ? hours + ' 小時' : '永久'}｜裝置 ${(t.devs || []).length}｜IP ${ipHours > 0 ? (t.ips || []).length : 0}）`); touch();
}
function unban(t) {
  t.banned = false; t.banUntil = 0; t.strikes = 0; t.flags = [];
  for (const k of ['devices', 'ips']) for (const key in db.bans[k]) if (db.bans[k][key].by === t.id) delete db.bans[k][key];
  log(`解除封鎖 ${t.name}`); touch();
}


// ---------- 全服統一股市（伺服器統一產生價格）----------
const SVOL = i => 0.3 - i * 0.009;
if (!db.market || !db.market.p || db.market.p.length !== 30) db.market = { p: Array.from({ length: 30 }, () => 10 + Math.random() * 100), frozen: false, volMul: 1 };
db.market.h = db.market.h && db.market.h.length === 30 ? db.market.h : db.market.p.map(p => Array.from({ length: 50 }, () => p * (0.9 + Math.random() * 0.2)));
const market = db.market; let mtick = 0;
const mktFull = () => ({ p: market.p, h: market.h });
setInterval(() => {
  if (market.frozen) return;
  market.p.forEach((p, i) => { const v = SVOL(i) * (market.volMul || 1); market.p[i] = Math.min(1e9, Math.max(1, p * (1 + Math.random() * v * 2 - v))); market.h[i].push(market.p[i]); market.h[i].shift(); });
  broadcast('market', { p: market.p });
  if (++mtick % 40 === 0) touch();
}, 800);
const stockCap = i => Math.max(1, ...(market.h[i] || [1])) * 1.3;

// ---------- 輕量防作弊：存檔合理性檢查 ----------
const NUM = (x, max = 1e100) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
const INT = (x, max = 1e15) => NUM(x, max) && Number.isInteger(x);
const rarityOf = id => id < 150 ? 0 : id < 230 ? 1 : id < 275 ? 2 : id < 293 ? 3 : id < 299 ? 4 : 5;
// 額外額度（無法歸因的收入，如運氣）：每小時可恢復 bucketHour，上限為其 2 倍；P2P 轉帳已停用，故預設調低
const bucketCap = () => 2 * (db.settings.bucketHour || 1e11), bucketRate = () => (db.settings.bucketHour || 1e11) / 3600;
const STOCK_PRICE_CAP = 5000;
function structural(s) { // 回傳 {fatal, reasons}
  const bad = (m) => ({ fatal: m, reasons: [] });
  if (!s || typeof s !== 'object' || !s.state || typeof s.state !== 'object') return bad('存檔格式錯誤');
  const st = s.state;
  if (!NUM(st.balance) || !NUM(st.bankDeposit || 0) || !NUM(st.bankLoan || 0)) return bad('金額數值異常');
  if (!Array.isArray(s.stocks || []) || (s.stocks || []).length > 30 || !(s.stocks || []).every(x => INT(x, 1e100))) return bad('股票資料異常');
  if (!Array.isArray(s.companies || []) || (s.companies || []).length > 30 || !(s.companies || []).every(c => c && INT(c.level, 5000))) return bad('公司資料異常');
  st.bankDeposit = st.bankDeposit || 0; st.bankLoan = st.bankLoan || 0; st.upgrades = st.upgrades || { click: 0, company: 0, discount: 0 }; st.inventory = st.inventory || {}; st.equippedBuffs = st.equippedBuffs || [];
  const r = [];
  if (!INT(st.rebirths, 300) || !INT(st.capitalCores) || !INT(st.currentCardLevel, 29) || !INT(st.maxCardOwnedLevel, 29) || !NUM(st.baseClick, 1e6)) return bad('進度數值異常');
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
  const sv = structural(s); if (sv.fatal) return sv; const off = db.settings.ac === 'off', hard = [];
  const st = s.state, r = sv.reasons, t = now(), old = p.save && p.save.state;
  const w = st.balance + st.bankDeposit;
  if (!old) { if (w > 1e12) log(`ℹ 新帳號 ${p.name} 帶入高額存檔 $${Math.floor(w)}（僅記錄）`); return { reasons: off ? [] : r, hard }; }
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
  const gc = Math.max(0, ...(p.recent || []).filter(x => !x.acked || t - x.t < 120000).map(x => x.card || 0));
  const oS = (p.save.stocks || []), nS = (s.stocks || []), oC = (p.save.companies || []), nC = (s.companies || []);
  let sold = 0, bought = 0, lv = 0;
  nS.forEach((n, i) => { const o = oS[i] || 0; if (n < o) sold += (o - n) * stockCap(i); else bought += n - o; });
  nC.forEach((c, i) => lv += Math.max(0, c.level - ((oC[i] && oC[i].level) || 0)));
  const loanUp = Math.max(0, st.bankLoan - (old.bankLoan || 0));
  const cash = oldW + earn + g.money + sold + loanUp;
  const allowed = oldW * 3 + earn + 1e7 + sold + loanUp + g.money + oldD * 0.0003 * dt;
  const excess = w - allowed;
  if (excess > 0) {
    p.bucket = Math.min(bucketCap(), (p.bucket === undefined ? bucketCap() : p.bucket) + (t - (p.bucketT || t)) / 1000 * bucketRate()); p.bucketT = t;
    if (excess <= p.bucket) p.bucket -= excess; else r.push(`資產暴增：${Math.floor(oldW)} → ${Math.floor(w)}（合理上限約 ${Math.floor(allowed)}）`);
  }
  // 連續暴增偵測：無法歸因的收入相對於資產的比例，半衰期 60 秒；防止每次存檔都「合理地」暴增 3 倍
  const explained = earn + sold + loanUp + g.money + oldD * 0.0003 * dt;
  p.luck = (p.luck || 0) * Math.pow(0.5, dt / 60) + Math.max(0, w - oldW - explained) / Math.max(oldW, 1e6);
  if (p.luck > 12) r.push(`短時間內連續出現無法解釋的收入暴增（指數 ${p.luck.toFixed(1)}）`);
  // 轉帳保護（不受防作弊模式影響）：伺服器剛扣款後 2 分鐘內，存檔資產不得回彈
  const rd = (p.debits || []).filter(x => t - x.t < 120000).reduce((a, x) => a + x.amt, 0);
  if (rd > 0) { const strict = oldW * 1.5 + explained + 1e5; if (w > strict) hard.push(`轉帳後資產不符（剛轉出 ${rd}，存檔資產 ${Math.floor(w)} 高於上限 ${Math.floor(strict)}）`); }
  if (bought > cash) r.push(`股票數量暴增（+${bought} 股，現金不足）`);
  if (lv * 300 > cash) r.push(`公司等級暴增（+${lv} 級，現金不足）`);
  const cnt = x => Object.values(x.inventory || {}).reduce((a, b) => a + b, 0) + (x.equippedBuffs || []).length;
  if (cnt(st) - cnt(old) > Math.floor(cash / 1e11) + g.buffs) r.push(`Buff 數量暴增（+${cnt(st) - cnt(old)}）`);
  if (st.capitalCores - (old.capitalCores || 0) > Math.floor((oldB + earn + g.money) / 1e16) + g.cores) r.push(`資本核心暴增（+${st.capitalCores - (old.capitalCores || 0)}）`);
  if (st.rebirths - (old.rebirths || 0) > 2 + g.rebirth) r.push(`重生次數暴增（+${st.rebirths - (old.rebirths || 0)}）`);
  if (st.maxCardOwnedLevel > (old.maxCardOwnedLevel || 0) && st.maxCardOwnedLevel > gc && Math.floor(100 * Math.pow(10, st.maxCardOwnedLevel - 1) * Math.pow(0.9, st.upgrades.discount)) > cash) r.push(`卡片等級暴增（→ ${st.maxCardOwnedLevel}）`);
  return { reasons: off ? [] : r, hard };
}


// ---------- 好友系統（伺服器端：邀請/接受、在線狀態、聊天、轉帳）----------
db.chats = db.chats || {}; db.unread = db.unread || {}; db.xfers = db.xfers || [];
const pairKey = (a, b) => a < b ? a + '_' + b : b + '_' + a;
const fr = p => { p.friends = p.friends || {}; p.reqIn = p.reqIn || []; p.reqOut = p.reqOut || []; return p; };
const pubP = p => ({ id: p.id, name: p.name, online: online(p.id) && !isBanned(p), lastSeen: p.lastSeen });
function friendsView(me) {
  fr(me); const tag = id => db.players[id];
  return {
    friends: Object.entries(me.friends).map(([id, m]) => { const f = tag(id); if (!f) return null; const st = (f.save && f.save.state) || {};
      return Object.assign(pubP(f), { nick: m.nick || '', fav: !!m.fav, since: m.since, rebirths: st.rebirths || 0, card: st.maxCardOwnedLevel || 0, wealth: Math.floor((st.balance || 0) + (st.bankDeposit || 0)), unread: db.unread[me.id + '>' + id] || 0 }); }).filter(Boolean),
    incoming: me.reqIn.map(tag).filter(Boolean).map(pubP), outgoing: me.reqOut.map(tag).filter(Boolean).map(pubP)
  };
}
const ping = (id, kind) => sendTo(id, 'friends', { kind });
async function friendApi(req, res, pl, p, m) {
  fr(pl); const J = (c, o) => json(res, c, o);
  if (p === '/api/friends' && m === 'GET') return J(200, friendsView(pl));
  if (p === '/api/chat' && m === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('with'); if (!pl.friends[id]) return J(403, { error: '不是好友' });
    db.unread[pl.id + '>' + id] = 0; touch(); return J(200, { msgs: (db.chats[pairKey(pl.id, id)] || []).slice(-60) });
  }
  if (m !== 'POST') return J(404, { error: 'not found' });
  const b = await body(req);
  if (p === '/api/friends/request') {
    if (pl.muted) return J(403, { error: '你已被禁言，無法發送邀請' });
    const name = String(b.name || '').trim(), t = Object.values(db.players).find(x => x.name === name);
    if (!t || isBanned(t)) return J(404, { error: '找不到這位玩家' }); if (t === pl) return J(400, { error: '不能加自己為好友' });
    fr(t); if (pl.friends[t.id]) return J(409, { error: '你們已經是好友了' });
    if (Object.keys(pl.friends).length >= 100) return J(400, { error: '好友數量已達上限（100）' });
    if (pl.reqIn.includes(t.id)) { acceptFriend(pl, t); return J(200, { ok: true, accepted: true }); }
    if (pl.reqOut.includes(t.id)) return J(409, { error: '已經送出邀請，請等待對方回應' });
    if (t.reqIn.length >= 50) return J(400, { error: '對方的待處理邀請過多' });
    pl.reqOut.push(t.id); t.reqIn.push(pl.id); touch(); ping(t.id, 'request'); sendTo(t.id, 'announce', { text: `👥 ${pl.name} 想加你為好友`, style: 'info' }); return J(200, { ok: true });
  }
  if (p === '/api/friends/respond') {
    const t = db.players[b.id]; if (!t || !pl.reqIn.includes(b.id)) return J(404, { error: '邀請不存在' });
    if (b.accept) acceptFriend(pl, fr(t)); else { pl.reqIn = pl.reqIn.filter(x => x !== t.id); t.reqOut = fr(t).reqOut.filter(x => x !== pl.id); touch(); }
    return J(200, { ok: true });
  }
  if (p === '/api/friends/cancel') { const t = db.players[b.id]; pl.reqOut = pl.reqOut.filter(x => x !== b.id); if (t) fr(t).reqIn = t.reqIn.filter(x => x !== pl.id); touch(); if (t) ping(t.id, 'request'); return J(200, { ok: true }); }
  if (p === '/api/friends/remove') {
    const t = db.players[b.id]; delete pl.friends[b.id]; if (t) { delete fr(t).friends[pl.id]; ping(t.id, 'removed'); } delete db.chats[pairKey(pl.id, b.id)]; touch(); return J(200, { ok: true });
  }
  if (p === '/api/friends/meta') { const f = pl.friends[b.id]; if (!f) return J(404, { error: '不是好友' }); if (b.nick !== undefined) f.nick = String(b.nick).slice(0, 16); if (b.fav !== undefined) f.fav = !!b.fav; touch(); return J(200, { ok: true }); }
  if (p === '/api/chat') {
    if (pl.muted) return J(403, { error: '你已被禁言' }); const t = db.players[b.to]; if (!t || !pl.friends[b.to]) return J(403, { error: '只能傳訊息給好友' });
    const text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200); if (!text) return J(400, { error: '訊息不可空白' });
    if (now() - (pl.lastChat || 0) < 700) return J(429, { error: '傳太快了' }); pl.lastChat = now();
    const k = pairKey(pl.id, t.id), arr = db.chats[k] = db.chats[k] || [], msg = { f: pl.id, t: now(), m: text }; arr.push(msg); if (arr.length > 100) arr.shift();
    db.unread[t.id + '>' + pl.id] = (db.unread[t.id + '>' + pl.id] || 0) + 1; touch(); sendTo(t.id, 'dm', { from: pl.id, name: pl.name, text, t: msg.t }); return J(200, { ok: true, msg });
  }
  if (p === '/api/friends/send') {
    if (pl.muted) return J(403, { error: '你已被禁言，無法轉帳' });
    const t = db.players[b.id], amt = Math.floor(Number(b.amount)), S = db.settings, f = pl.friends[b.id];
    if (!t || !f) return J(403, { error: '只能轉帳給好友' });
    if (isBanned(t)) return J(403, { error: '對方帳號異常，無法轉帳' });
    if (!(amt >= 1) || !Number.isFinite(amt)) return J(400, { error: '金額錯誤' });
    if (S.xferMinFriendMin > 0 && now() - f.since < S.xferMinFriendMin * 60000) return J(403, { error: `成為好友滿 ${S.xferMinFriendMin} 分鐘後才能轉帳` });
    if (S.xferMax > 0 && amt > S.xferMax) return J(400, { error: `單筆轉帳上限為 $${S.xferMax.toLocaleString('en-US')}` });
    pl.sentLog = (pl.sentLog || []).filter(x => now() - x.t < 86400000);
    if (S.xferDaily > 0 && pl.sentLog.reduce((a, x) => a + x.amt, 0) + amt > S.xferDaily) return J(400, { error: `24 小時內轉出總額上限為 $${S.xferDaily.toLocaleString('en-US')}` });
    if (now() - (pl.lastXfer || 0) < 3000) return J(429, { error: '轉帳太頻繁，請稍後再試' });
    const st = pl.save && pl.save.state; if (!st || st.balance < amt) return J(400, { error: '餘額不足（以伺服器最新存檔為準，請稍等幾秒再試）' });
    // 原子操作：伺服器先扣款並提升存檔版本（舊版本的存檔會被拒收），玩家端依回應同步扣款；收款方以指令入帳
    st.balance -= amt; pl.rev = (pl.rev || 0) + 1; pl.lastXfer = now(); pl.debits = (pl.debits || []).concat({ t: now(), amt }).slice(-20); pl.sentLog.push({ t: now(), amt });
    queue(t, mkCmd({ type: 'money', value: amt, msg: `💸 ${pl.name} 轉給你 $${amt.toLocaleString('en-US')}` }));
    db.xfers.unshift({ t: now(), from: pl.name, to: t.name, amt }); db.xfers.length = Math.min(db.xfers.length, 300);
    log(`轉帳 ${pl.name} → ${t.name}：$${amt}`); touch(); return J(200, { ok: true, rev: pl.rev, amount: amt });
  }
  return J(404, { error: 'not found' });
}
function acceptFriend(a, b) {
  const now_ = now(); fr(a); fr(b);
  a.reqIn = a.reqIn.filter(x => x !== b.id); a.reqOut = a.reqOut.filter(x => x !== b.id); b.reqIn = b.reqIn.filter(x => x !== a.id); b.reqOut = b.reqOut.filter(x => x !== a.id);
  a.friends[b.id] = { since: now_ }; b.friends[a.id] = { since: now_ }; touch(); ping(a.id, 'accepted'); ping(b.id, 'accepted');
  sendTo(b.id, 'announce', { text: `👥 你和 ${a.name} 成為好友了！`, style: 'info' }); sendTo(a.id, 'announce', { text: `👥 你和 ${b.name} 成為好友了！`, style: 'info' });
}


// ---------- 賽季與排行榜 ----------
db.season = db.season || null; db.seasonHistory = db.seasonHistory || [];
const METRICS = { rebirths: '重生次數', wealth: '總資產（現金+存款）', cores: '資本核心', gain: '資產成長（賽季最高資產 − 起始資產）' };
const stOf = p => (p.save && p.save.state) || {};
function scoreOf(p, metric) {
  const st = stOf(p), w = wealthOf(p);
  if (metric === 'rebirths') return (st.rebirths || 0) + Math.min(0.999, Math.log10(1 + w) / 400);
  if (metric === 'card') return (st.maxCardOwnedLevel || 0) + Math.min(0.999, Math.log10(1 + w) / 400);
  if (metric === 'cores') return st.capitalCores || 0;
  if (metric === 'gain') { const S = db.season; if (!S) return 0; const base = S.base[p.id] !== undefined ? S.base[p.id] : (p.created > S.start ? 0 : w); return Math.max(0, Math.max(S.peak[p.id] || 0, w) - base); }
  return w;
}
const crownOf = p => p.crown ? ({ 1: '👑', 2: '🥈', 3: '🥉' })[p.crown.rank] || '' : '';
const seasonOn = () => db.season && !db.season.ended ? db.season : null;
function ranking(board) {
  const S = seasonOn(), metric = board === 'season' ? (S ? S.metric : 'wealth') : board;
  let list = Object.values(db.players).filter(p => p.save && !isBanned(p) && !p.hideLb);
  if (board === 'season') { if (!S) return []; list = list.filter(p => p.lastSeen >= S.start || online(p.id)); }
  return list.map(p => ({ p, s: scoreOf(p, metric) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
}
const lbCache = {}; const lbClear = () => Object.keys(lbCache).forEach(k => delete lbCache[k]);
const rankingCached = board => { const c = lbCache[board]; if (c && now() - c.t < 8000) return c.r; const r = ranking(board); lbCache[board] = { t: now(), r }; return r; };
const REWARD_SCALE = i => [1, 0.5, 0.25][i] || 0.1;
function seasonPub() { const S = seasonOn(); if (!S) return null; return { id: S.id, name: S.name, metric: S.metric, metricName: METRICS[S.metric], start: S.start, end: S.end, n: S.n, prize: describe(prizeCmd(S, 1)) }; }
function startSeason(o) {
  if (seasonOn()) throw '目前已有進行中的賽季，請先結算或取消';
  if (!METRICS[o.metric]) throw '排名依據錯誤'; const days = Number(o.days); if (!(days > 0 && days <= 365)) throw '天數需介於 0～365';
  const S = { id: uid(4), name: String(o.name || '賽季').slice(0, 30), metric: o.metric, start: now(), end: now() + days * 86400e3, days, n: Math.min(Math.max(parseInt(o.n) || 10, 1), 50), prize: o.prize, auto: !!o.auto, ended: false, base: {}, peak: {} };
  prizeCmd(S, 1); // 驗證獎勵設定
  if (S.metric === 'gain') Object.values(db.players).forEach(p => { if (p.save) S.base[p.id] = wealthOf(p); });
  db.season = S; lbClear(); log(`開始賽季：${S.name}（${METRICS[S.metric]}，${days} 天）`);
  broadcast('announce', { text: `🏆 新賽季開始：${S.name}（排名：${METRICS[S.metric]}，共 ${days} 天）`, style: 'event' }); touch(); return S;
}
function endSeason(settle) {
  const S = seasonOn(); if (!S) throw '目前沒有進行中的賽季'; const r = settle ? ranking('season').slice(0, S.n) : []; S.ended = true; let top = [];
  if (settle) {
    Object.values(db.players).forEach(p => { delete p.crown; });
    r.forEach((x, i) => { queue(x.p, prizeCmd(S, REWARD_SCALE(i), `🏆 ${S.name} 第 ${i + 1} 名獎勵`)); if (i < 3) x.p.crown = { rank: i + 1, season: S.name, t: now() }; });
    top = r.slice(0, 10).map(x => ({ name: x.p.name, score: Math.floor(x.s) }));
    broadcast('announce', { text: r.length ? `🏆 ${S.name} 結算！冠軍：${r[0].p.name}${r[1] ? '、亞軍：' + r[1].p.name : ''}${r[2] ? '、季軍：' + r[2].p.name : ''}` : `🏆 ${S.name} 結束，無人上榜`, style: 'event' });
  } else broadcast('announce', { text: `🏆 ${S.name} 已取消`, style: 'info' });
  db.seasonHistory.unshift({ id: S.id, name: S.name, metric: S.metric, start: S.start, end: now(), settled: !!settle, top }); db.seasonHistory.length = Math.min(db.seasonHistory.length, 30);
  log(`${settle ? '結算' : '取消'}賽季：${S.name}`); lbClear(); touch();
  if (settle && S.auto) { try { startSeason({ name: S.name, days: S.days, metric: S.metric, n: S.n, prize: S.prize, auto: true }); } catch (e) { log('自動開啟下一賽季失敗：' + e); } }
}
setInterval(() => { const S = seasonOn(); if (S && now() >= S.end) { try { endSeason(true); } catch (e) { console.error(e); } } }, 5000);

// ---------- 工具 ----------
const json = (res, code, obj, hdr) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, hdr)); res.end(JSON.stringify(obj)); };
const body = (req, max = 3e6) => new Promise((ok, no) => { let s = ''; req.on('data', d => { s += d; if (s.length > max) { req.destroy(); no('too big'); } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
const adminTokens = new Map(); const fails = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const playerByToken = t => Object.values(db.players).find(p => p.token === t);
const summary = p => { const s = (p.save && p.save.state) || {}; return { id: p.id, name: p.name, online: online(p.id), balance: Math.floor(s.balance || 0), bank: Math.floor(s.bankDeposit || 0), loan: Math.floor(s.bankLoan || 0), rebirths: s.rebirths || 0, cores: s.capitalCores || 0, buffs: Object.values(s.inventory || {}).reduce((a, b) => a + b, 0), lastSeen: p.lastSeen, banned: p.banned, banReason: p.banReason, pending: p.pending.length, strikes: p.strikes || 0, flags: p.flags || [] }; };

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  // ---- 玩家 ----
  if (p === '/api/status') return json(res, 200, { maintenance: db.settings.maintenance, motd: db.settings.motd, online: [...conns.keys()].length });
  if (p === '/api/login' && m === 'POST') {
    const b = await body(req); const name = String(b.name || '').trim().slice(0, 16), ip = ipOf(req), pw = String(b.pw || '');
    const dev = cookieDev(req) || String(b.dev || '').replace(/\W/g, '').slice(0, 32) || uid(8);
    if (!name) return json(res, 400, { error: '請輸入名稱' });
    const hit = banHit(dev, ip); if (hit) return json(res, 403, { error: '此裝置或網路已被封鎖：' + (hit.reason || '') });
    if (db.settings.maintenance) return json(res, 503, { error: '伺服器維護中：' + (db.settings.motd || '請稍後再試') });
    const fk = ip + '|' + name, f = loginFails.get(fk) || { n: 0, t: 0 };
    if (f.n >= 8 && now() - f.t < 600000) return json(res, 429, { error: '嘗試次數過多，請 10 分鐘後再試' });
    let pl = Object.values(db.players).find(x => x.name === name);
    if (b.register) {
      if (pl) return json(res, 409, { error: '此名稱已被使用，請換一個名稱，或直接登入' });
      if (pw.length < 4 || pw.length > 64) return json(res, 400, { error: '密碼需為 4～64 個字元' });
      pl = db.players[uid(4)] = { name, token: uid(12), save: null, created: now(), lastSeen: now(), banned: false, pending: [], redeemed: [] };
      pl.id = Object.keys(db.players).find(k => db.players[k] === pl); setPw(pl, pw); log(`新玩家註冊：${name}`);
    } else {
      if (!pl) return json(res, 404, { error: '找不到這個帳號。第一次玩請按「註冊新帳號」（若伺服器資料曾被重置，舊帳號會一併消失）' });
      if (!((b.key && b.key === pl.token) || checkPw(pl, pw))) { loginFails.set(fk, { n: f.n + 1, t: now() }); return json(res, 401, { error: pw || b.key ? '密碼錯誤' : '請輸入密碼' }); }
      loginFails.delete(fk);
    }
    if (isBanned(pl)) return json(res, 403, { error: '帳號已被封鎖：' + (pl.banReason || '') });
    pl.devs = pl.devs || []; pl.ips = pl.ips || [];
    if (!pl.devs.includes(dev)) pl.devs.push(dev); if (!pl.ips.includes(ip)) pl.ips.push(ip); pl.devs = pl.devs.slice(-10); pl.ips = pl.ips.slice(-10);
    pl.lastSeen = now(); touch();
    return json(res, 200, { name: pl.name, key: pl.token, hasSave: !!pl.save, needPw: !pl.pwHash }, { 'Set-Cookie': `mcdev=${dev}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly` });
  }
  const pl = playerByToken(req.headers['x-token'] || url.searchParams.get('key'));
  if (p.startsWith('/api/') && !p.startsWith('/api/admin')) {
    if (!pl) return json(res, 401, { error: '未登入' });
    if (isBanned(pl)) return json(res, 403, { error: '帳號已被封鎖：' + (pl.banReason || '') });
    if (p === '/api/save' && m === 'GET') return json(res, 200, { save: pl.save, rev: pl.rev || 0 });
    if (p === '/api/save' && m === 'POST') {
      const b = await body(req); const s = b.save;
      if (b.rev !== undefined && b.rev < (pl.rev || 0)) return json(res, 409, { error: 'stale', stale: true, rev: pl.rev || 0 });
      const v = vet(pl, s);
      if (v.fatal) { pl.strikes = (pl.strikes || 0) + 1; touch(); return json(res, 422, { error: '偵測到異常數據：' + v.fatal }); }
      if (v.hard && v.hard.length) { pl.strikes = (pl.strikes || 0) + 1; pl.flags = pl.flags || []; pl.flags.unshift({ t: now(), r: v.hard }); pl.flags.length = Math.min(pl.flags.length, 20); log(`⚠ 轉帳保護攔截 ${pl.name}：${v.hard.join('；')}`); touch(); return json(res, 422, { error: '偵測到異常數據（轉帳保護），已還原為伺服器進度' }); }
      let reject = false;
      if (v.reasons.length) {
        pl.strikes = (pl.strikes || 0) + 1; pl.flags = pl.flags || []; pl.flags.unshift({ t: now(), r: v.reasons }); pl.flags.length = Math.min(pl.flags.length, 20);
        if (now() - (pl.lastFlagLog || 0) > 60000) { pl.lastFlagLog = now(); log(`⚠ 可疑存檔 ${pl.name}：${v.reasons.join('；')}`); }
        if (db.settings.autoBan > 0 && pl.strikes >= db.settings.autoBan && !pl.banned) banPlayer(pl, '系統偵測作弊', 0, 24, true);
        reject = db.settings.ac === 'reject';
      }
      pl.lastSeen = now(); touch();
      if (reject) return json(res, 422, { error: '偵測到異常數據，已還原為伺服器進度' });
      if (pl.save && (!pl.snaps || !pl.snaps.length || now() - pl.snaps[0].t > 30 * 60000)) { pl.snaps = pl.snaps || []; pl.snaps.unshift({ t: now(), save: pl.save }); pl.snaps.length = Math.min(pl.snaps.length, 8); }
      pl.save = s; pl.lastSaveAt = now(); const SS = seasonOn(); if (SS && SS.metric === 'gain') SS.peak[pl.id] = Math.max(SS.peak[pl.id] || 0, (s.state.balance || 0) + (s.state.bankDeposit || 0));
      return json(res, 200, { ok: true, rev: pl.rev || 0 });
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
    if (p === '/api/leaderboard' && m === 'GET') {
      const board = url.searchParams.get('board') || 'season'; if (!['season', 'wealth', 'rebirths', 'cores', 'card'].includes(board)) return json(res, 400, { error: '未知榜單' });
      const S = seasonOn(), metric = board === 'season' ? (S ? S.metric : 'wealth') : board, r = rankingCached(board), me = r.findIndex(x => x.p === pl), sc = x => (metric === 'rebirths' || metric === 'card') ? Math.floor(x) : Math.floor(x);
      const last = db.seasonHistory.find(h => h.settled);
      return json(res, 200, { board, metric, season: seasonPub(), total: r.length, hidden: !!pl.hideLb, last: last ? { name: last.name, top: last.top.slice(0, 3) } : null,
        top: r.slice(0, 50).map((x, i) => ({ rank: i + 1, name: x.p.name, crown: crownOf(x.p), score: sc(x.s), online: online(x.p.id), me: x.p === pl })), me: me >= 0 ? { rank: me + 1, score: sc(r[me].s) } : null });
    }
    if (p === '/api/setpw' && m === 'POST') {
      const b = await body(req), np = String(b.pw || '');
      if (np.length < 4 || np.length > 64) return json(res, 400, { error: '密碼需為 4～64 個字元' });
      if (pl.pwHash && !checkPw(pl, String(b.old || ''))) return json(res, 401, { error: '舊密碼錯誤' });
      setPw(pl, np); log(`${pl.name} 設定/修改密碼`); return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/friends') || p === '/api/chat') return friendApi(req, res, pl, p, m);
    if (p === '/api/claim' && m === 'POST') {
      const b = await body(req), e = activeEvents().find(x => x.id === b.id && x.type === 'packet');
      if (!e) return json(res, 410, { error: '紅包已結束' }); e.claimed = e.claimed || [];
      if (e.claimed.includes(pl.id)) return json(res, 409, { error: '你已經搶過了' });
      if (e.claimed.length >= e.n) return json(res, 410, { error: '紅包被搶完了！' });
      e.claimed.push(pl.id); queue(pl, prizeCmd(e, 1, `🧧 搶到紅包：${e.name}`));
      if (e.claimed.length >= e.n) broadcast('announce', { text: `🧧 ${e.name} 已被搶完！`, style: 'info' });
      return json(res, 200, { ok: true, rank: e.claimed.length });
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!conns.has(pl.id)) conns.set(pl.id, new Set()); conns.get(pl.id).add(res);
      sse(res, 'hello', { now: now(), events: pubEvents(), motd: db.settings.motd, maintenance: db.settings.maintenance });
      sse(res, 'market', mktFull());
      pl.pending.forEach(c => sse(res, 'cmd', c));
      activeEvents().forEach(e => { if (e.type === 'login') giveLogin(e, pl); if (e.type === 'packet' && !(e.claimed || []).includes(pl.id) && e.n - (e.claimed || []).length > 0) sse(res, 'packet', { id: e.id, name: e.name, left: e.n - (e.claimed || []).length }); });
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
    const b = m === 'POST' ? await body(req, p === '/admin/api/restore' ? 6e7 : 3e6) : {}; let r;
    try {
      if (p === '/admin/api/overview') {
        const all = Object.values(db.players).map(summary);
        return json(res, 200, { gh: { on: GH_ON, last: ghState.last, err: ghState.err, repo: GH.repo, pulled: ghState.pulled }, meta: db.meta, persistWarn: PERSIST_WARN, hist: db.hist, flagged: all.filter(x => x.strikes).length, total: all.length, online: all.filter(x => x.online).length, money: all.reduce((a, x) => a + x.balance, 0), settings: db.settings, events: db.events.filter(e => !e.ended).length, top: all.sort((a, b) => b.balance - a.balance).slice(0, 10) });
      }
      if (p === '/admin/api/players') { const q = (url.searchParams.get('q') || '').toLowerCase(); return json(res, 200, Object.values(db.players).filter(x => x.name.toLowerCase().includes(q)).map(summary).sort((a, b) => b.online - a.online || b.balance - a.balance)); }
      if ((r = p.match(/^\/admin\/api\/player\/(\w+)(?:\/(\w+))?$/))) {
        const t = db.players[r[1]]; if (!t) return json(res, 404, { error: '找不到玩家' }); const act = r[2];
        if (m === 'DELETE') { kick(t.id, '帳號已被刪除'); delete db.players[t.id]; log(`刪除玩家 ${t.name}`); touch(); return json(res, 200, { ok: true }); }
        if (!act) { const alts = Object.values(db.players).filter(x => x !== t).map(x => ({ id: x.id, name: x.name, banned: x.banned, by: (x.devs || []).some(d => (t.devs || []).includes(d)) ? '同裝置' : (x.ips || []).some(i => (t.ips || []).includes(i)) ? '同 IP' : '' })).filter(x => x.by); return json(res, 200, Object.assign(summary(t), { key: t.token, created: t.created, note: t.note || '', hasPw: !!t.pwHash, hideLb: !!t.hideLb, muted: !!t.muted, friendCount: Object.keys(t.friends || {}).length, alts, ips: t.ips || [], devCount: (t.devs || []).length, snaps: (t.snaps || []).map(x => ({ t: x.t, balance: Math.floor((x.save.state || {}).balance || 0) })) })); }
        if (act === 'cmd') { const c = mkCmd(b); queue(t, c); log(`對 ${t.name} 執行：${describe(c)}`); return json(res, 200, { ok: true, online: online(t.id) }); }
        if (act === 'ban') { if (b.banned) banPlayer(t, String(b.reason || '違規').slice(0, 60), Number(b.hours) || 0, b.ipHours === undefined ? 24 : Number(b.ipHours) || 0, b.alts !== false); else unban(t); return json(res, 200, { ok: true }); }
        if (act === 'resetpw') { const np = String(b.pw || ''); if (np.length < 4) throw '密碼至少 4 個字元'; setPw(t, np); log(`重設 ${t.name} 的密碼`); return json(res, 200, { ok: true }); }
        if (act === 'hidelb') { t.hideLb = !!b.hide; lbClear(); log(`${t.hideLb ? '從排行榜隱藏' : '恢復排行榜顯示'} ${t.name}`); touch(); return json(res, 200, { ok: true }); }
        if (act === 'mute') { t.muted = !!b.muted; log(`${t.muted ? '禁言' : '解除禁言'} ${t.name}`); touch(); return json(res, 200, { ok: true }); }
        if (act === 'chats') { const out = []; Object.entries(db.chats).forEach(([k, arr]) => { if (k.split('_').includes(t.id)) arr.forEach(x => out.push({ t: x.t, from: (db.players[x.f] || {}).name || '?', to: (db.players[k.split('_').find(i => i !== x.f)] || {}).name || '?', m: x.m })); }); return json(res, 200, out.sort((a, c) => c.t - a.t).slice(0, 40)); }
        if (act === 'note') { t.note = String(b.note || '').slice(0, 300); log(`備註 ${t.name}`); touch(); return json(res, 200, { ok: true }); }
        if (act === 'rollback') { const sn = (t.snaps || [])[parseInt(b.index)]; if (!sn) throw '找不到該快照'; t.save = sn.save; t.lastSaveAt = now(); t.strikes = 0; t.flags = []; t.rev = (t.rev || 0) + 1; t.debits = []; sendTo(t.id, 'reload', {}); log(`回溯 ${t.name} 的存檔到 ${new Date(sn.t).toLocaleString('zh-TW')}`); touch(); return json(res, 200, { ok: true }); }
        if (act === 'clearflags') { t.strikes = 0; t.flags = []; touch(); return json(res, 200, { ok: true }); }
        if (act === 'kick') { kick(t.id, String(b.reason || '你已被管理員踢出')); log(`踢出 ${t.name}`); return json(res, 200, { ok: true }); }
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
        const TYPES = ['click', 'income', 'all', 'rain', 'market', ...PRIZE_TYPES];
        if (!TYPES.includes(b.type)) throw '活動類型錯誤';
        const factor = Number(b.factor), mins = Number(b.minutes), delay = Number(b.delayMinutes) || 0;
        if (!(mins > 0)) throw '持續時間需為正數';
        if (!PRIZE_TYPES.includes(b.type) && !(factor > 0)) throw '倍率/金額需為正數';
        if (b.type === 'market' && !(factor > 0 && factor <= 100)) throw '股價倍率需介於 0~100';
        let prize = null; if (PRIZE_TYPES.includes(b.type)) { prize = b.prize || {}; mkCmd(Object.assign({ msg: 'x' }, prize)); prize = { type: prize.type, value: prize.value, id: prize.id, rarity: prize.rarity, count: prize.count, msg: prize.msg }; }
        const start = now() + delay * 60000, e = { id: uid(4), name: String(b.name || '限時活動').slice(0, 30), type: b.type, factor: factor || 1, interval: Math.max(5, Number(b.interval) || 30), n: Math.min(Math.max(parseInt(b.n) || 1, 1), 1000), prize, repeat: Math.max(0, Number(b.repeat) || 0), revert: !!b.revert, start, end: start + mins * 60000, ended: false };
        db.events.push(e); log(`建立活動：${e.name}（${e.type}，${mins} 分鐘${e.repeat ? '，每 ' + e.repeat + ' 分鐘重複' : ''}）`); touch(); pushEvents();
        if (delay > 0) broadcast('announce', { text: `📣 活動預告：${e.name}，${delay} 分鐘後開始！`, style: 'event' });
        return json(res, 200, e);
      }
      if ((r = p.match(/^\/admin\/api\/events\/(\w+)\/end$/)) && m === 'POST') { const e = db.events.find(x => x.id === r[1]); if (e) { log(`提前結束活動 ${e.name}`); e.repeat = 0; if (!e.startedNotified) { e.ended = true; touch(); pushEvents(); } else endEvent(e, true); } return json(res, 200, { ok: true }); }
      if (p === '/admin/api/codes' && m === 'GET') return json(res, 200, db.codes);
      if (p === '/admin/api/codes' && m === 'POST') {
        const code = String(b.code || uid(3)).trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw '代碼需 3~24 位英數字';
        mkCmd(b); db.codes[code] = { cmd: { type: b.type, value: b.value, id: b.id, rarity: b.rarity, count: b.count }, maxUses: Math.max(1, parseInt(b.maxUses) || 1), uses: 0, expires: b.expireMinutes ? now() + b.expireMinutes * 60000 : 0 };
        log(`建立兌換碼 ${code}`); touch(); return json(res, 200, { code });
      }
      if ((r = p.match(/^\/admin\/api\/codes\/([\w-]+)$/)) && m === 'DELETE') { delete db.codes[r[1]]; touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/settings' && m === 'POST') {
        if (b.maintenance !== undefined) { db.settings.maintenance = !!b.maintenance; if (b.maintenance) [...conns.keys()].forEach(id => kick(id, '伺服器進入維護：' + (b.motd || db.settings.motd))); }
        if (b.motd !== undefined) db.settings.motd = String(b.motd).slice(0, 100);
        if (['off', 'flag', 'reject'].includes(b.ac)) db.settings.ac = b.ac;
        if (b.autoBan !== undefined) db.settings.autoBan = Math.max(0, parseInt(b.autoBan) || 0);
        for (const [k, mx] of [['xferMinFriendMin', 1440], ['xferMax', 1e100], ['xferDaily', 1e100], ['bucketHour', 1e100]]) if (b[k] !== undefined) db.settings[k] = Math.min(mx, Math.max(0, Number(b[k]) || 0));
        if (b.maxCps !== undefined) db.settings.maxCps = Math.min(200, Math.max(1, Number(b.maxCps) || 25)); log(`設定更新 maintenance=${db.settings.maintenance}`); touch(); return json(res, 200, db.settings);
      }
      if (p === '/admin/api/market' && m === 'GET') return json(res, 200, { p: market.p, frozen: market.frozen, volMul: market.volMul || 1 });
      if (p === '/admin/api/market' && m === 'POST') {
        const f = Number(b.factor), idx = b.index === 'all' || b.index === undefined ? -1 : parseInt(b.index);
        if (b.action === 'shock') { if (!(f > 0 && f <= 100)) throw '倍率需介於 0~100'; market.p.forEach((p, i) => { if (idx < 0 || idx === i) { market.p[i] = Math.min(1e9, Math.max(1, p * f)); market.h[i][49] = market.p[i]; } }); log(`股市調整：${idx < 0 ? '全部股票' : '股票 #' + idx} x${f}`); if (b.announce) broadcast('announce', { text: f >= 1 ? `📈 股市大漲！${idx < 0 ? '全部股票' : '股票代號 ' + (1000 + idx * 13)} x${f}` : `📉 股市大跌！${idx < 0 ? '全部股票' : '股票代號 ' + (1000 + idx * 13)} x${f}`, style: 'event' }); }
        else if (b.action === 'freeze') { market.frozen = !!b.on; log(market.frozen ? '股市凍結' : '股市恢復'); }
        else if (b.action === 'vol') { if (!(f >= 0 && f <= 10)) throw '波動倍率需介於 0~10'; market.volMul = f; log(`股市波動倍率 x${f}`); }
        else if (b.action === 'reset') { market.p = market.p.map(() => 10 + Math.random() * 100); market.h = market.p.map(p => Array.from({ length: 50 }, () => p * (0.9 + Math.random() * 0.2))); db.market.p = market.p; db.market.h = market.h; log('重設股市價格'); }
        else throw '未知操作';
        touch(); broadcast('market', mktFull()); return json(res, 200, { ok: true });
      }
      if (p === '/admin/api/pushnow' && m === 'POST') { if (!GH_ON) throw '尚未設定 GH_TOKEN / GH_REPO'; await ghPush(true); if (ghState.err) throw '備份失敗：' + ghState.err; return json(res, 200, { ok: true, last: ghState.last }); }
      if (p === '/admin/api/xfers') return json(res, 200, db.xfers);
      if (p === '/admin/api/season' && m === 'GET') { const S = seasonOn(); return json(res, 200, { season: S && Object.assign(seasonPub(), { auto: S.auto, days: S.days }), board: S ? ranking('season').slice(0, 20).map(x => ({ name: x.p.name, score: Math.floor(x.s) })) : [], history: db.seasonHistory }); }
      if (p === '/admin/api/season' && m === 'POST') { if (b.action === 'start') startSeason(b); else if (b.action === 'end') endSeason(true); else if (b.action === 'cancel') endSeason(false); else throw '未知操作'; return json(res, 200, { ok: true }); }
      if (p === '/admin/api/log') return json(res, 200, db.log);
      if (p === '/admin/api/bans' && m === 'GET') { const f = o => Object.entries(o).filter(([, e]) => livE(e)).map(([key, e]) => Object.assign({ key }, e)); return json(res, 200, { players: Object.values(db.players).filter(isBanned).map(summary), devices: f(db.bans.devices), ips: f(db.bans.ips) }); }
      if (p === '/admin/api/bans/remove') { if (!['devices', 'ips'].includes(b.kind)) throw '類型錯誤'; delete db.bans[b.kind][b.key]; log(`移除${b.kind === 'ips' ? ' IP ' : '裝置'}封鎖`); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/bans/ip') { const ip = String(b.ip || '').trim(); if (!ip) throw '請輸入 IP'; db.bans.ips[ip] = { reason: String(b.reason || '手動封鎖'), t: now(), exp: Number(b.hours) > 0 ? now() + b.hours * 3600e3 : 0, name: '(手動)' }; log(`手動封鎖 IP ${ip}`); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/autoann' && m === 'GET') return json(res, 200, db.autoAnn);
      if (p === '/admin/api/autoann' && m === 'POST') { const text = String(b.text || '').slice(0, 200), every = Math.max(1, Number(b.every) || 10); if (!text) throw '內容空白'; db.autoAnn.push({ id: uid(4), text, style: b.style || 'info', every, next: now() + every * 60000 }); log(`建立定時公告：${text}（每 ${every} 分鐘）`); touch(); return json(res, 200, { ok: true }); }
      if ((r = p.match(/^\/admin\/api\/autoann\/(\w+)$/)) && m === 'DELETE') { db.autoAnn = db.autoAnn.filter(x => x.id !== r[1]); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/restore' && m === 'POST') { const d = b.db; if (!d || typeof d.players !== 'object') throw '備份檔格式錯誤'; const keep = db.market; db = Object.assign({ players: {}, codes: {}, events: [], settings: db.settings, log: [], bans: { devices: {}, ips: {} }, autoAnn: [], hist: [] }, d); db.market = keep; conns.forEach((_, id) => kick(id, '伺服器還原資料，請重新登入')); log('還原備份'); touch(); return json(res, 200, { ok: true, players: Object.keys(db.players).length }); }
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
  const hdr = {};
  if (f === 'index.html') {
    const dev = cookieDev(req) || uid(8), hit = banHit(dev, ipOf(req));
    if (hit) { res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<meta name=viewport content="width=device-width"><h2 style="font-family:sans-serif;text-align:center;margin-top:30vh">此裝置或網路已被封鎖</h2>'); }
    hdr['Set-Cookie'] = `mcdev=${dev}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly`;
  }
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }, hdr)); res.end(d); });
}).listen(PORT, () => console.log(`極簡資本伺服器：http://localhost:${PORT}　後台：http://localhost:${PORT}/admin`));
