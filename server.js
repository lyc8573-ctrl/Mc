// 極簡資本 伺服器：零依賴（只用 Node 內建模組）。啟動：ADMIN_PASSWORD=你的密碼 node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (ADMIN_PASSWORD === 'admin1234') console.warn('⚠ 正在使用預設後台密碼，請設定環境變數 ADMIN_PASSWORD！');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_PLANS = [{ name: 'Lite', price: 5e23, mult: 20 }, { name: 'Premium', price: 5e24, mult: 60 }, { name: 'Premium Plus', price: 5e25, mult: 200 }]; // 價格 5e23 = 5000垓；mult = 專屬 Buff 倍率
let db = { players: {}, codes: {}, events: [], settings: { maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25, xferMinFriendMin: 5, qrMinAgeMin: 10, xferMax: 0, xferDaily: 0, bucketHour: 1e11 }, log: [] };

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
db.settings = Object.assign({ maintenance: false, motd: '', ac: 'flag', autoBan: 0, maxCps: 25, xferMinFriendMin: 5, qrMinAgeMin: 10, xferMax: 0, xferDaily: 0, bucketHour: 1e11, plans: DEFAULT_PLANS, ptsRate: 0.1, ptsPer: 1000, ptsCardStep: 0.01 }, db.settings);
db.meta = db.meta || { created: Date.now(), boots: 0 }; db.meta.boots++; db.deleted = db.deleted || {};
console.log(`已載入 ${Object.keys(db.players).length} 位玩家；資料目錄：${DATA_DIR}；第 ${db.meta.boots} 次啟動`);
let preRestore = null; try { preRestore = fs.readFileSync(path.join(DATA_DIR, 'pre-restore.json'), 'utf8'); } catch {}
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
  if (b.type === 'card') { c.value = parseInt(b.value); if (!(c.value >= 0 && c.value <= 34)) throw '卡片等級需為 0~34'; }
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


// ---------- 會員方案（每 7 天用遊戲內金錢扣款；高階方案有專屬 Buff）----------
const SUB_PERIOD = 7 * 86400e3;
const planList = () => (Array.isArray(db.settings.plans) && db.settings.plans.length ? db.settings.plans : DEFAULT_PLANS);
const subTier = p => (p.sub && p.sub.exp > now() && planList()[p.sub.tier - 1]) ? p.sub.tier : 0;
const subMult = p => { const t = subTier(p); return t ? Math.max(1, Number(planList()[t - 1].mult) || 1) : 1; };
const subPub = p => { const t = subTier(p), pl = planList()[t - 1]; return { now: now(), tier: t, name: t ? pl.name : '', mult: t ? subMult(p) : 1, exp: t ? p.sub.exp : 0, auto: !!(p.sub && p.sub.auto), plans: planList().map((x, i) => ({ tier: i + 1, name: x.name, price: x.price, mult: x.mult })) }; };
const MAX_CARD_LV = 38; // 卡片總數：第 N 張卡額外回饋 N × step
const ptsPub = () => ({ rate: Number(db.settings.ptsRate) >= 0 ? Number(db.settings.ptsRate) : 0.1, step: Number(db.settings.ptsCardStep) >= 0 ? Number(db.settings.ptsCardStep) : 0.01, per: Math.max(1, Number(db.settings.ptsPer) || 1000) });
const pushSub = p => sendTo(p.id, 'sub', subPub(p));
const balOf = p => Math.max(0, Number(p.save && p.save.state && p.save.state.balance) || 0);
function chargeSub(p, tier, why) { const pl = planList()[tier - 1]; queue(p, mkCmd({ type: 'money', value: -pl.price, msg: `💎 ${why}：${pl.name}` })); if (p.save && p.save.state) p.save.state.balance = Math.max(0, balOf(p) - pl.price); }
setInterval(() => {
  for (const p of Object.values(db.players)) {
    if (!p.sub || p.sub.exp > now()) continue;
    const pl = planList()[p.sub.tier - 1];
    if (p.sub.auto && pl && !isBanned(p) && balOf(p) >= pl.price) {
      chargeSub(p, p.sub.tier, '會員自動續訂'); p.sub.exp = (now() - p.sub.exp < 3600e3 ? p.sub.exp : now()) + SUB_PERIOD; log(`會員續訂 ${p.name}：${pl.name}`); touch(); pushSub(p);
    } else {
      const why = p.sub.auto && pl ? '（餘額不足，無法自動續訂）' : ''; log(`會員到期 ${p.name}：${pl ? pl.name : '?'}${why}`); delete p.sub; touch();
      sendTo(p.id, 'announce', { text: `💎 你的會員已到期${why}`, style: 'info' }); pushSub(p);
    }
  }
}, 30000);

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




// ---------- 徹底刪除玩家（帳號 + 所有關聯資料）----------
function purgePlayer(t) {
  const id = t.id, n = { friends: 0, requests: 0, chats: 0, season: 0, events: 0 };
  kick(id, '你的帳號已被管理員刪除', true);
  Object.values(db.players).forEach(x => { if (x === t) return;
    if (x.friends && x.friends[id]) { delete x.friends[id]; n.friends++; }
    ['reqIn', 'reqOut'].forEach(k => { if (x[k] && x[k].includes(id)) { x[k] = x[k].filter(y => y !== id); n.requests++; } });
    if (x.friends) ping(x.id, 'removed'); });
  Object.keys(db.chats || {}).forEach(k => { if (k.split('_').includes(id)) { delete db.chats[k]; n.chats++; } });
  Object.keys(db.unread || {}).forEach(k => { if (k.split('>').includes(id)) delete db.unread[k]; });
  const S = db.season; if (S) { if (S.base && id in S.base) { delete S.base[id]; n.season++; } if (S.peak && id in S.peak) { delete S.peak[id]; n.season++; } }
  (db.events || []).forEach(e => { if (e.claimed && e.claimed.includes(id)) { e.claimed = e.claimed.filter(y => y !== id); n.events++; } if (e.base && id in e.base) { delete e.base[id]; n.events++; } });
  db.deleted[t.token] = { name: t.name, t: now() }; // 墓碑：讓這個帳號的瀏覽器下次連線時清掉本機存檔，避免舊進度被重新帶回來
  const nm = t.name; db.seasonHistory.forEach(h => { h.top = (h.top || []).filter(x => x.name !== nm); });
  db.xfers = (db.xfers || []).filter(x => x.from !== nm && x.to !== nm);
  if (!t.banned) ['devices', 'ips'].forEach(k => Object.keys(db.bans[k]).forEach(key => { if (db.bans[k][key].by === id) delete db.bans[k][key]; })); // 被封鎖者的裝置/IP 封鎖會保留
  conns.delete(id); delete db.players[id]; lbClear(); touch();
  return n;
}
function cleanOrphans(purgeBans) {
  const ids = new Set(Object.keys(db.players)), names = new Set(Object.values(db.players).map(p => p.name)), n = { 好友關係: 0, 好友邀請: 0, 聊天室: 0, 未讀: 0, 賽季資料: 0, 活動資料: 0, 轉帳紀錄: 0, 賽季歷史: 0, 封鎖紀錄: 0 };
  Object.values(db.players).forEach(x => {
    Object.keys(x.friends || {}).forEach(k => { if (!ids.has(k)) { delete x.friends[k]; n.好友關係++; } });
    ['reqIn', 'reqOut'].forEach(k => { if (x[k]) { const l = x[k].length; x[k] = x[k].filter(y => ids.has(y)); n.好友邀請 += l - x[k].length; } });
  });
  Object.keys(db.chats || {}).forEach(k => { if (!k.split('_').every(i => ids.has(i))) { delete db.chats[k]; n.聊天室++; } });
  Object.keys(db.unread || {}).forEach(k => { if (!k.split('>').every(i => ids.has(i))) { delete db.unread[k]; n.未讀++; } });
  const S = db.season; if (S) ['base', 'peak'].forEach(f => Object.keys(S[f] || {}).forEach(k => { if (!ids.has(k)) { delete S[f][k]; n.賽季資料++; } }));
  (db.events || []).forEach(e => { if (e.claimed) { const l = e.claimed.length; e.claimed = e.claimed.filter(y => ids.has(y)); n.活動資料 += l - e.claimed.length; } if (e.base) Object.keys(e.base).forEach(k => { if (!ids.has(k)) { delete e.base[k]; n.活動資料++; } }); });
  const gone = new Set(Object.values(db.deleted || {}).map(d => d.name).filter(nm => !names.has(nm)));
  const xl = (db.xfers || []).length; db.xfers = (db.xfers || []).filter(x => !gone.has(x.from) && !gone.has(x.to)); n.轉帳紀錄 = xl - db.xfers.length;
  db.seasonHistory.forEach(h => { const l = (h.top || []).length; h.top = (h.top || []).filter(x => !gone.has(x.name)); n.賽季歷史 += l - h.top.length; });
  if (purgeBans) ['devices', 'ips'].forEach(k => Object.keys(db.bans[k]).forEach(key => { const e = db.bans[k][key]; if (e.by && !ids.has(e.by)) { delete db.bans[k][key]; n.封鎖紀錄++; } }));
  lbClear(); touch(); return n;
}

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
function kick(id, reason, wipe) { sendTo(id, 'kick', { reason, wipe: !!wipe }); (conns.get(id) || []).forEach(r => { try { r.end(); } catch {} }); }
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
const buffRand = i => { let t = Math.floor((i + 1) * 2654435761) >>> 0; t ^= t >>> 15; t = Math.imul(t, 0x85EBCA6B); t ^= t >>> 13; t = Math.imul(t, 0xC2B2AE35); t ^= t >>> 16; return (t >>> 0) / 4294967296; };
const buffEffect = id => { const r = rarityOf(id); let e = 2 + r * 2 + Math.floor(buffRand(id) * (r + 3)); if (r === 5) e *= 2; return e; };
function structural(s) { // 回傳 {fatal, reasons}
  const bad = (m) => ({ fatal: m, reasons: [] });
  if (!s || typeof s !== 'object' || !s.state || typeof s.state !== 'object') return bad('存檔格式錯誤');
  const st = s.state;
  if (!NUM(st.balance) || !NUM(st.bankDeposit || 0) || !NUM(st.bankLoan || 0)) return bad('金額數值異常');
  if (st.kpPts !== undefined && !NUM(st.kpPts)) return bad('點數數值異常');
  if (!Array.isArray(s.stocks || []) || (s.stocks || []).length > 30 || !(s.stocks || []).every(x => INT(x, 1e100))) return bad('股票資料異常');
  if (!Array.isArray(s.companies || []) || (s.companies || []).length > 30 || !(s.companies || []).every(c => c && INT(c.level, 5000))) return bad('公司資料異常');
  st.bankDeposit = st.bankDeposit || 0; st.bankLoan = st.bankLoan || 0; st.upgrades = st.upgrades || { click: 0, company: 0, discount: 0 }; st.inventory = st.inventory || {}; st.equippedBuffs = st.equippedBuffs || [];
  const r = [];
  if (!INT(st.rebirths, 300) || !INT(st.capitalCores) || !INT(st.currentCardLevel, 37) || !INT(st.maxCardOwnedLevel, 34) || !NUM(st.baseClick, 1e6)) return bad('進度數值異常');
  st.btnOwned = st.btnOwned || 0; st.btnSel = st.btnSel || 0; if (!INT(st.btnOwned, 30) || !INT(st.btnSel, 30)) return bad('按鈕等級異常'); if (st.btnSel > st.btnOwned) r.push('使用中的按鈕高於已購買等級');
  const fix38 = (k, max) => { const a = st[k]; if (a === undefined) { st[k] = Array(38).fill(0); return true; } if (!Array.isArray(a) || a.length > 38 || !a.every(x => INT(x, max))) return false; st[k] = Array.from({ length: 38 }, (_, i) => a[i] || 0); return true; };
  if (!fix38('cardStars', 10) || !fix38('cardAwake', 1) || !fix38('codex', 1)) return bad('卡片資料異常');
  if (st.stats === undefined) st.stats = { clicks: 0 }; if (!st.stats || !INT(st.stats.clicks, 1e12)) return bad('統計資料異常');
  if (st.currentCardLevel < 35 ? st.currentCardLevel > st.maxCardOwnedLevel : !st.codex[st.currentCardLevel]) r.push('目前卡片等級高於已擁有最高等級');
  if (st.cardAwake.some((a, i) => a && st.cardStars[i] < 10)) r.push('覺醒卡星級不足 10 星');
  for (const k of ['click', 'company', 'discount']) if (!INT(st.upgrades[k], 1e6)) return bad('天賦數值異常');
  if (typeof st.inventory !== 'object' || !Object.entries(st.inventory).every(([k, v]) => INT(+k, 299) && INT(v, 1e7))) return bad('背包資料異常');
  if (!Array.isArray(st.equippedBuffs) || st.equippedBuffs.length > 5) r.push('裝備 Buff 欄位數異常');
  else for (const b of st.equippedBuffs) {
    if (!b || !INT(b.id, 299)) { r.push(`Buff 編號不合法（${b && b.id}）`); break; }
    b.rarityIndex = rarityOf(b.id); b.effect = buffEffect(b.id); // 倍率以伺服器為準，玩家端無法自訂
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
  const mult = (Math.floor((old.equippedBuffs || []).reduce((a, b) => a * ((b && b.effect) || 1), 1)) || 1) * subMult(p);
  const BTN_MULT = 4, btnPrice = k => Number('1e' + (3 + 2 * (k - 1))); // 主畫面按鈕：每級價格 ×100、點擊收益 ×4
  const oBtn = Math.min(old.btnOwned || 0, 30), nBtn = Math.min(st.btnOwned || 0, 30); let btnCost = 0; for (let k = oBtn + 1; k <= nBtn; k++) btnCost += btnPrice(k);
  const btnLvl = btnCost <= (old.balance || 0) + (old.bankDeposit || 0) + 1e7 ? Math.max(oBtn, nBtn) : oBtn;
  // 卡片系統（升星／覺醒／圖鑑加成／專屬技能）造成的收入倍率上限，皆用上一次存檔推算
  const oL = oCards >= 35 ? [33, 36, 40][oCards - 35] : oCards, oSt = Math.min(10, ((old.cardStars || [])[oCards] | 0) + 1), oAw = ((old.cardAwake || [])[oCards] || oSt >= 10) ? 1.5 : 1;
  const oN = Math.min(38, ((old.codex || []).reduce((a, b) => a + (b ? 1 : 0), 0)) + 1), collF = 1 + 0.01 * oN + [[10, .05], [20, .1], [30, .15], [35, .25], [38, .5]].reduce((a, [k, v]) => a + (oN >= k ? v : 0), 0);
  const oKind = oCards === 35 ? 'all' : oCards === 36 ? 'crit' : oCards === 37 ? 'all' : ['crit', 'passive', 'click', 'all'][oCards % 4], oSp = (0.05 + 0.02 * oL) * 2;
  const skillF = oSt >= 5 ? (oKind === 'crit' ? 5 : 1 + oSp) : 1, burstF = oAw > 1 ? 4 : 1;
  const cardFac = (1 + 0.15 * oSt) * oAw * collF * skillF * burstF;
  const click = Math.floor((old.baseClick || 1) * (1 + 0.75 * oL) * mult * Math.pow(BTN_MULT, btnLvl) * Math.pow(2, oReb) * (1 + ou.click)) * ev.click;
  let pas = 0; (p.save.companies || []).forEach((c, i) => pas += ((c && c.level) || 0) * Math.floor(Math.floor(10 * Math.pow(1.45, i)) * 0.75 * (1 + 0.375 * oL) * (1 + ou.company)));
  const earn = (click * cps + pas * mult * ev.income) * cardFac * dt * 3;
  const oldB = old.balance || 0, oldD = old.bankDeposit || 0, oldW = oldB + oldD;
  const g = { money: 0, buffs: 0, cores: 0, rebirth: 0 };
  (p.recent || []).forEach(x => { if (!x.acked || t - x.t < 120000) for (const k in g) g[k] += x[k]; });
  const gc = Math.max(0, ...(p.recent || []).filter(x => !x.acked || t - x.t < 120000).map(x => x.card || 0));
  const oS = (p.save.stocks || []), nS = (s.stocks || []), oC = (p.save.companies || []), nC = (s.companies || []);
  let sold = 0, bought = 0, lv = 0;
  nS.forEach((n, i) => { const o = oS[i] || 0; if (n < o) sold += (o - n) * stockCap(i); else bought += n - o; });
  nC.forEach((c, i) => lv += Math.max(0, c.level - ((oC[i] && oC[i].level) || 0)));
  const loanUp = Math.max(0, st.bankLoan - (old.bankLoan || 0));
  const redeemed = Math.max(0, (Number(old.kpPts) || 0) - (Number(st.kpPts) || 0)) / ptsPub().per; // 兌換 KUN 點數得到的錢
  const cash = oldW + earn + g.money + sold + loanUp + redeemed;
  const allowed = oldW * 3 + earn + 1e7 + sold + loanUp + g.money + redeemed + oldD * 0.0003 * dt;
  const excess = w - allowed;
  if (excess > 0) {
    p.bucket = Math.min(bucketCap(), (p.bucket === undefined ? bucketCap() : p.bucket) + (t - (p.bucketT || t)) / 1000 * bucketRate()); p.bucketT = t;
    if (excess <= p.bucket) p.bucket -= excess; else r.push(`資產暴增：${Math.floor(oldW)} → ${Math.floor(w)}（合理上限約 ${Math.floor(allowed)}）`);
  }
  // 連續暴增偵測：無法歸因的收入相對於資產的比例，半衰期 60 秒；防止每次存檔都「合理地」暴增 3 倍
  const explained = earn + sold + loanUp + g.money + redeemed + oldD * 0.0003 * dt;
  p.luck = (p.luck || 0) * Math.pow(0.5, dt / 60) + Math.max(0, w - oldW - explained) / Math.max(oldW, 1e6);
  if (p.luck > 12) r.push(`短時間內連續出現無法解釋的收入暴增（指數 ${p.luck.toFixed(1)}）`);
  // 轉帳保護（不受防作弊模式影響）：伺服器剛扣款後 2 分鐘內，存檔資產不得回彈
  const rd = (p.debits || []).filter(x => t - x.t < 120000).reduce((a, x) => a + x.amt, 0);
  if (rd > 0) { const strict = oldW * 1.5 + explained + 1e5; if (w > strict) hard.push(`轉帳後資產不符（剛轉出 ${rd}，存檔資產 ${Math.floor(w)} 高於上限 ${Math.floor(strict)}）`); }
  if (bought > cash) r.push(`股票數量暴增（+${bought} 股，現金不足）`);
  if (lv * 300 > cash) r.push(`公司等級暴增（+${lv} 級，現金不足）`);
  const ptsGain = (Number(st.kpPts) || 0) - (Number(old.kpPts) || 0); if (ptsGain > cash * (ptsPub().rate + MAX_CARD_LV * ptsPub().step) + 10) r.push(`點數暴增（+${Math.floor(ptsGain)}）`);
  const cnt = x => Object.values(x.inventory || {}).reduce((a, b) => a + b, 0) + (x.equippedBuffs || []).length;
  if (cnt(st) - cnt(old) > Math.floor(cash / 1e19) + g.buffs) r.push(`Buff 數量暴增（+${cnt(st) - cnt(old)}）`);
  if (st.capitalCores - (old.capitalCores || 0) > Math.floor((oldB + earn + g.money) / 1e16) + g.cores) r.push(`資本核心暴增（+${st.capitalCores - (old.capitalCores || 0)}）`);
  if (st.rebirths - (old.rebirths || 0) > 2 + g.rebirth) r.push(`重生次數暴增（+${st.rebirths - (old.rebirths || 0)}）`);
  // 卡片升星／覺醒／圖鑑旗標／累計點擊
  const cL = i => i >= 35 ? [33, 36, 40][i - 35] : i, cPrice = i => cL(i) === 0 ? 1000 : 100 * Math.pow(10, cL(i) - 1);
  let starSum = 0, awakeCost = 0;
  for (let i = 0; i < 38; i++) { const o = (old.cardStars || [])[i] | 0, n = st.cardStars[i]; for (let q = o; q < n; q++) starSum += cPrice(i) * Math.pow(2.5, q + 1); if (st.cardAwake[i] && !((old.cardAwake || [])[i])) awakeCost += 5 + cL(i); }
  if (starSum > cash) r.push('卡片星級暴增（現金不足）');
  const coreGain = Math.floor((oldB + earn + g.money) / 1e16) + g.cores;
  if (awakeCost > 0 && st.capitalCores > (old.capitalCores || 0) + coreGain - awakeCost) r.push('卡片覺醒未扣除資本核心');
  for (let i = 0; i < 38; i++) if (st.codex[i] && !((old.codex || [])[i])) { const ok = i < 35 ? i <= st.maxCardOwnedLevel : [st.rebirths >= 3, st.stats.clicks >= 1e5, st.codex.slice(0, 35).every(Boolean)][i - 35]; if (!ok) r.push(`圖鑑旗標不合法（#${i}）`); }
  if (st.stats.clicks - ((old.stats || {}).clicks || 0) > cps * dt * 3 + 1000) r.push('累計點擊數暴增');
  if (btnCost > cash) r.push(`按鈕等級暴增（${oBtn} → ${nBtn}，現金不足）`);
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

// 轉帳核心（好友轉帳與掃碼轉帳共用）：限額、冷卻、餘額以伺服器存檔為準，伺服器先扣款，收款方用指令入帳
function xferCore(pl, t, amt, S) {
  if (!(amt >= 1) || !Number.isFinite(amt)) return [400, { error: '金額錯誤' }];
  if (S.xferMax > 0 && amt > S.xferMax) return [400, { error: `單筆轉帳上限為 $${S.xferMax.toLocaleString('en-US')}` }];
  pl.sentLog = (pl.sentLog || []).filter(x => now() - x.t < 86400000);
  if (S.xferDaily > 0 && pl.sentLog.reduce((a, x) => a + x.amt, 0) + amt > S.xferDaily) return [400, { error: `24 小時內轉出總額上限為 $${S.xferDaily.toLocaleString('en-US')}` }];
  if (now() - (pl.lastXfer || 0) < 3000) return [429, { error: '轉帳太頻繁，請稍後再試' }];
  const st = pl.save && pl.save.state; if (!st || st.balance < amt) return [400, { error: '餘額不足（以伺服器最新存檔為準，請稍等幾秒再試）' }];
  st.balance -= amt; pl.rev = (pl.rev || 0) + 1; pl.lastXfer = now(); pl.debits = (pl.debits || []).concat({ t: now(), amt }).slice(-20); pl.sentLog.push({ t: now(), amt });
  queue(t, mkCmd({ type: 'money', value: amt, msg: `💸 ${pl.name} 轉給你 $${amt.toLocaleString('en-US')}` }));
  db.xfers.unshift({ t: now(), from: pl.name, to: t.name, amt }); db.xfers.length = Math.min(db.xfers.length, 300);
  log(`轉帳 ${pl.name} → ${t.name}：$${amt}`); touch(); return [200, { ok: true, rev: pl.rev, amount: amt }];
}
async function friendApi(req, res, pl, p, m) {
  fr(pl); const J = (c, o) => json(res, c, o);
  if (p === '/api/friends' && m === 'GET') return J(200, friendsView(pl));
  if (p === '/api/chat' && m === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('with'); if (!pl.friends[id]) return J(403, { error: '不是好友' });
    db.unread[pl.id + '>' + id] = 0; touch(); return J(200, { msgs: (db.chats[pairKey(pl.id, id)] || []).slice(-60) });
  }
  if (p === '/api/pay/lookup' && m === 'GET') {
    const u = new URL(req.url, 'http://x'); if (u.searchParams.get('me')) return J(200, { id: pl.id, name: pl.name });
    const t = db.players[u.searchParams.get('id')]; if (!t || isBanned(t)) return J(404, { error: '找不到這個收款碼對應的玩家' });
    return J(200, { id: t.id, name: t.name, online: online(t.id), friend: !!pl.friends[t.id], self: t === pl });
  }
  if (m !== 'POST') return J(404, { error: 'not found' });
  const b = await body(req);
  if (p === '/api/pay/send') {
    if (pl.muted) return J(403, { error: '你已被禁言，無法轉帳' });
    const S = db.settings, t = db.players[b.to], amt = Math.floor(Number(b.amount));
    if (!S.xferOn && S.xferOn !== undefined) return J(403, { error: '轉帳功能目前已關閉' });
    if (!t || t === pl) return J(403, { error: '收款對象不存在，或不能轉給自己' }); if (isBanned(t)) return J(403, { error: '對方帳號異常，無法轉帳' });
    if (!pl.friends[t.id]) { // 非好友：多幾道防線，避免拿小號洗錢
      if (S.qrMinAgeMin > 0 && now() - (pl.created || 0) < S.qrMinAgeMin * 60000) return J(403, { error: `帳號註冊滿 ${S.qrMinAgeMin} 分鐘後，才能轉給非好友` });
      if ((pl.devs || []).some(d => (t.devs || []).includes(d))) return J(403, { error: '不能轉給同一台裝置上的其他帳號' });
    }
    const [code, out] = xferCore(pl, t, amt, S); return J(code, out);
  }
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
    if (S.xferMinFriendMin > 0 && now() - f.since < S.xferMinFriendMin * 60000) return J(403, { error: `成為好友滿 ${S.xferMinFriendMin} 分鐘後才能轉帳` });
    const [code, out] = xferCore(pl, t, amt, S); return J(code, out);
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
      if (!pl && b.key && db.deleted[b.key]) return json(res, 410, { error: '這個帳號已被管理員刪除', deleted: true });
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
    if (!pl) { if (db.deleted[req.headers['x-token'] || url.searchParams.get('key')]) return json(res, 410, { error: '這個帳號已被管理員刪除', deleted: true }); return json(res, 401, { error: '未登入' }); }
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
    if (p === '/api/sub' && m === 'GET') return json(res, 200, subPub(pl));
    if (p === '/api/sub' && m === 'POST') {
      const b = await body(req), cur = subTier(pl);
      if (b.action === 'cancel' || b.action === 'resume') { if (!cur) return json(res, 400, { error: '你目前沒有有效的會員方案' }); pl.sub.auto = b.action === 'resume'; touch(); pushSub(pl); return json(res, 200, subPub(pl)); }
      if (b.action !== 'buy') return json(res, 400, { error: '未知操作' });
      const tier = parseInt(b.tier), plan = planList()[tier - 1];
      if (!plan) return json(res, 400, { error: '沒有這個方案' });
      if (tier <= cur) return json(res, 400, { error: tier === cur ? '你已經是這個方案了（到期會自動續訂）' : '你已有更高階的方案，無法降級' });
      if (balOf(pl) < plan.price) return json(res, 400, { error: '餘額不足' });
      chargeSub(pl, tier, cur ? '升級會員' : '訂閱會員');
      pl.sub = { tier, exp: now() + SUB_PERIOD, auto: true, since: now() };
      log(`${cur ? '會員升級' : '會員訂閱'} ${pl.name}：${plan.name}`); touch(); pushSub(pl);
      return json(res, 200, subPub(pl));
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
    if (p.startsWith('/api/friends') || p.startsWith('/api/pay/') || p === '/api/chat') return friendApi(req, res, pl, p, m);
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
      sse(res, 'hello', { now: now(), events: pubEvents(), motd: db.settings.motd, maintenance: db.settings.maintenance, pts: ptsPub() });
      sse(res, 'sub', subPub(pl));
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
        return json(res, 200, { keepalive: { selfOn: SELF_ON, self: lastHealth.self, ext: lastHealth.ext }, gh: { on: GH_ON, last: ghState.last, err: ghState.err, repo: GH.repo, pulled: ghState.pulled }, meta: db.meta, persistWarn: PERSIST_WARN, hist: db.hist, flagged: all.filter(x => x.strikes).length, total: all.length, online: all.filter(x => x.online).length, money: all.reduce((a, x) => a + x.balance, 0), settings: db.settings, events: db.events.filter(e => !e.ended).length, top: all.sort((a, b) => b.balance - a.balance).slice(0, 10) });
      }
      if (p === '/admin/api/players') { const q = (url.searchParams.get('q') || '').toLowerCase(); return json(res, 200, Object.values(db.players).filter(x => x.name.toLowerCase().includes(q)).map(summary).sort((a, b) => b.online - a.online || b.balance - a.balance)); }
      if ((r = p.match(/^\/admin\/api\/player\/(\w+)(?:\/(\w+))?$/))) {
        const t = db.players[r[1]]; if (!t) return json(res, 404, { error: '找不到玩家' }); const act = r[2];
        if (m === 'DELETE') { const name = t.name, n = purgePlayer(t); log(`徹底刪除玩家 ${name}（好友關係 ${n.friends}、邀請 ${n.requests}、聊天 ${n.chats}、賽季 ${n.season}、活動 ${n.events}）`); return json(res, 200, { ok: true, removed: n }); }
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
        for (const [k, mx] of [['xferMinFriendMin', 1440], ['qrMinAgeMin', 1440], ['xferMax', 1e100], ['xferDaily', 1e100], ['bucketHour', 1e100]]) if (b[k] !== undefined) db.settings[k] = Math.min(mx, Math.max(0, Number(b[k]) || 0));
        if (b.maxCps !== undefined) db.settings.maxCps = Math.min(200, Math.max(1, Number(b.maxCps) || 25)); log(`設定更新 maintenance=${db.settings.maintenance}`); touch(); return json(res, 200, db.settings);
      }
      if (p === '/admin/api/members' && m === 'GET') return json(res, 200, { plans: planList(), pts: ptsPub(), now: now(), members: Object.values(db.players).filter(x => x.sub).map(x => ({ id: x.id, name: x.name, tier: x.sub.tier, active: subTier(x) > 0, exp: x.sub.exp, auto: !!x.sub.auto })) });
      if (p === '/admin/api/plans' && m === 'POST') {
        const arr = Array.isArray(b.plans) ? b.plans : []; if (arr.length < 1 || arr.length > 8) throw '方案數量需 1~8';
        db.settings.plans = arr.map((x, i) => { const price = Number(x.price), mult = Number(x.mult); if (!Number.isFinite(price) || price < 0) throw `方案 ${i + 1} 價格不正確`; if (!Number.isFinite(mult) || mult < 1 || mult > 1e9) throw `方案 ${i + 1} 倍率需 1 以上`; return { name: String(x.name || '方案' + (i + 1)).slice(0, 20), price, mult }; });
        log('會員方案已更新'); touch(); conns.forEach((_, id) => db.players[id] && pushSub(db.players[id])); return json(res, 200, { ok: true });
      }
      if (p === '/admin/api/pts' && m === 'POST') {
        const rate = Number(b.rate), per = Number(b.per), step = b.step === undefined || b.step === '' ? ptsPub().step : Number(b.step); if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw '回饋比例需介於 0%~100%'; if (!Number.isFinite(per) || per < 1) throw '兌換點數至少 1'; if (!Number.isFinite(step) || step < 0 || step > 0.1) throw '每張卡加成需介於 0%~10%';
        db.settings.ptsRate = rate; db.settings.ptsPer = per; db.settings.ptsCardStep = step; log(`點數設定：基本回饋 ${rate * 100}%、每張卡 +${step * 100}%、${per} 點 = $1`); touch(); broadcast('pts', ptsPub()); return json(res, 200, { ok: true });
      }
      if (p === '/admin/api/member/grant' && m === 'POST') {
        const t = db.players[b.id]; if (!t) throw '找不到玩家'; const tier = parseInt(b.tier) || 0;
        if (!tier) { delete t.sub; log(`後台收回會員：${t.name}`); }
        else { if (!planList()[tier - 1]) throw '沒有這個方案'; const days = Math.min(3650, Math.max(1, Number(b.days) || 7)); t.sub = { tier, exp: now() + days * 86400e3, auto: false, since: now(), gift: true }; log(`後台發放會員：${t.name} ${planList()[tier - 1].name} ${days} 天`); }
        touch(); pushSub(t); return json(res, 200, { ok: true });
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
      if (p === '/admin/api/cleanup' && m === 'POST') { const n = cleanOrphans(!!b.bans); log('清理殘留資料：' + (Object.entries(n).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join('、') || '無')); return json(res, 200, n); }
      if (p === '/admin/api/log') return json(res, 200, db.log);
      if (p === '/admin/api/bans' && m === 'GET') { const f = o => Object.entries(o).filter(([, e]) => livE(e)).map(([key, e]) => Object.assign({ key }, e)); return json(res, 200, { players: Object.values(db.players).filter(isBanned).map(summary), devices: f(db.bans.devices), ips: f(db.bans.ips) }); }
      if (p === '/admin/api/bans/remove') { if (!['devices', 'ips'].includes(b.kind)) throw '類型錯誤'; delete db.bans[b.kind][b.key]; log(`移除${b.kind === 'ips' ? ' IP ' : '裝置'}封鎖`); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/bans/ip') { const ip = String(b.ip || '').trim(); if (!ip) throw '請輸入 IP'; db.bans.ips[ip] = { reason: String(b.reason || '手動封鎖'), t: now(), exp: Number(b.hours) > 0 ? now() + b.hours * 3600e3 : 0, name: '(手動)' }; log(`手動封鎖 IP ${ip}`); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/autoann' && m === 'GET') return json(res, 200, db.autoAnn);
      if (p === '/admin/api/autoann' && m === 'POST') { const text = String(b.text || '').slice(0, 200), every = Math.max(1, Number(b.every) || 10); if (!text) throw '內容空白'; db.autoAnn.push({ id: uid(4), text, style: b.style || 'info', every, next: now() + every * 60000 }); log(`建立定時公告：${text}（每 ${every} 分鐘）`); touch(); return json(res, 200, { ok: true }); }
      if ((r = p.match(/^\/admin\/api\/autoann\/(\w+)$/)) && m === 'DELETE') { db.autoAnn = db.autoAnn.filter(x => x.id !== r[1]); touch(); return json(res, 200, { ok: true }); }
      if (p === '/admin/api/restore' && m === 'POST') {
        const d = b.db; if (!d || typeof d.players !== 'object' || Array.isArray(d.players)) throw '備份檔格式錯誤（找不到玩家資料）';
        delete d._format; delete d._exportedAt; const mode = ['replace', 'missing', 'overwrite'].includes(b.mode) ? b.mode : 'replace';
        const snap = JSON.stringify(db); preRestore = snap; try { fs.writeFileSync(path.join(DATA_DIR, 'pre-restore.json'), snap); } catch {}
        const rep = { mode, added: 0, overwritten: 0, skipped: [] };
        if (mode === 'replace') { const keep = db.market; db = Object.assign({ players: {}, codes: {}, events: [], settings: db.settings, log: [], bans: { devices: {}, ips: {} }, autoAnn: [], hist: [] }, d); db.market = keep; rep.added = Object.keys(db.players).length; }
        else {
          const names = new Map(Object.values(db.players).map(x => [x.name, x.id]));
          for (const [id, pl] of Object.entries(d.players)) {
            if (!pl || typeof pl !== 'object') continue; pl.id = pl.id || id;
            const clash = names.get(pl.name); if (clash && clash !== id) { rep.skipped.push(pl.name); continue; }
            if (!db.players[id]) { db.players[id] = pl; rep.added++; } else if (mode === 'overwrite') { db.players[id] = pl; rep.overwritten++; }
          }
          for (const [k, v] of Object.entries(d.codes || {})) if (mode === 'overwrite' || !db.codes[k]) db.codes[k] = v;
          for (const kind of ['devices', 'ips']) for (const [k, v] of Object.entries((d.bans || {})[kind] || {})) if (!db.bans[kind][k]) db.bans[kind][k] = v;
          for (const [k, v] of Object.entries(d.deleted || {})) if (!db.deleted[k]) db.deleted[k] = v;
          for (const e of d.events || []) if (!db.events.some(x => x.id === e.id)) db.events.push(e);
          for (const h of d.seasonHistory || []) if (!db.seasonHistory.some(x => x.id === h.id)) db.seasonHistory.push(h);
          if (!seasonOn() && d.season && !d.season.ended) db.season = d.season;
          for (const [k, v] of Object.entries(d.chats || {})) if (!db.chats[k]) db.chats[k] = v;
          for (const [k, v] of Object.entries(d.unread || {})) if (db.unread[k] === undefined) db.unread[k] = v;
        }
        Object.values(db.players).forEach(pl => { pl.pending = pl.pending || []; pl.redeemed = pl.redeemed || []; pl.devs = pl.devs || []; pl.ips = pl.ips || []; fr(pl); });
        cleanOrphans(false); lbClear(); [...conns.keys()].forEach(id => kick(id, '伺服器匯入備份，請重新登入'));
        log(`匯入備份（${mode === 'replace' ? '完全取代' : mode === 'missing' ? '補回遺失玩家' : '以備份覆蓋'}）：新增 ${rep.added}、覆蓋 ${rep.overwritten}、略過同名 ${rep.skipped.length}`); touch();
        return json(res, 200, Object.assign({ ok: true, players: Object.keys(db.players).length }, rep));
      }
      if (p === '/admin/api/restore/undo' && m === 'POST') {
        if (!preRestore) throw '沒有可撤銷的匯入'; const keep = db.market; db = Object.assign({ players: {}, codes: {}, events: [], settings: db.settings, log: [], bans: { devices: {}, ips: {} }, autoAnn: [], hist: [] }, JSON.parse(preRestore)); db.market = keep; preRestore = null; try { fs.unlinkSync(path.join(DATA_DIR, 'pre-restore.json')); } catch {}
        [...conns.keys()].forEach(id => kick(id, '伺服器還原資料，請重新登入')); lbClear(); log('撤銷上次匯入，已還原為匯入前的資料'); touch(); return json(res, 200, { ok: true, players: Object.keys(db.players).length });
      }
      if (p === '/admin/api/restore/status') return json(res, 200, { canUndo: !!preRestore });
      if (p === '/admin/api/backup') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="mc-backup-${new Date().toISOString().slice(0, 10)}.txt"` }); return res.end(JSON.stringify(Object.assign({ _format: 'mc-backup-1', _exportedAt: now() }, db))); }
    } catch (e) { return json(res, 400, { error: String(e) }); }
  }
  json(res, 404, { error: 'not found' });
}

// ---------- PWA（manifest / service worker / 圖示 都內嵌在這裡，不需要另外上傳檔案）----------
const PWA_SW = "// 極簡資本 Service Worker：頁面「網路優先」（確保封鎖/更新即時生效），失敗才用快取。API 與 SSE 完全不碰。\nconst CACHE = 'mc-pwa-v1';\nconst CORE = ['/', '/online.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];\nself.addEventListener('install', e => {\n  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));\n});\nself.addEventListener('activate', e => {\n  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));\n});\nself.addEventListener('fetch', e => {\n  const r = e.request, u = new URL(r.url);\n  if (r.method !== 'GET') return;\n  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/admin') || u.pathname === '/healthz') return; // 不快取 API / SSE / 後台\n  const same = u.origin === location.origin;\n  if (r.mode === 'navigate') {\n    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('/', cp)); } return res; }).catch(() => caches.match('/').then(m => m || new Response('目前離線，請連上網路後再試', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));\n    return;\n  }\n  if (same) { // 同源靜態檔：網路優先，離線用快取\n    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r)));\n    return;\n  }\n  // 第三方函式庫（qrcode / zxing / peerjs）：快取優先，沒有再抓\n  if (/cdnjs\\.cloudflare\\.com|unpkg\\.com/.test(u.host)) {\n    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));\n  }\n});\n";
const PWA_MANIFEST = {"name": "極簡資本", "short_name": "極簡資本", "description": "極簡資本 放置型遊戲", "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait", "background_color": "#ffffff", "theme_color": "#ffffff", "lang": "zh-TW", "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"}, {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]};
const PWA_FILES = {
  'sw.js': { type: 'text/javascript; charset=utf-8', body: PWA_SW, hdr: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } },
  'manifest.webmanifest': { type: 'application/manifest+json; charset=utf-8', body: JSON.stringify(PWA_MANIFEST), hdr: { 'Cache-Control': 'no-cache' } },
  'icons/icon-192.png': { type: 'image/png', body: Buffer.from('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', 'base64'), hdr: { 'Cache-Control': 'public, max-age=86400' } },
  'icons/icon-512.png': { type: 'image/png', body: Buffer.from('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', 'base64'), hdr: { 'Cache-Control': 'public, max-age=86400' } },
};
let lastHealth = { ext: 0, self: 0 };
const SELF_URL = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '', SELF_ON = !!SELF_URL && process.env.KEEPALIVE !== 'off';
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { if (url.searchParams.get('self')) lastHealth.self = now(); else lastHealth.ext = now(); res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/api/')) return api(req, res, url).catch(e => { console.error(e); json(res, 500, { error: 'server error' }); });
  const f = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : url.pathname.slice(1);
  if (Object.prototype.hasOwnProperty.call(PWA_FILES, f)) { const w = PWA_FILES[f]; res.writeHead(200, Object.assign({ 'Content-Type': w.type }, w.hdr)); return res.end(w.body); }
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
if (SELF_ON) { // 每 9 分鐘用公開網址打一次自己：Render 免費方案 15 分鐘沒有外部流量就會休眠
  const pingSelf = () => fetch(SELF_URL.replace(/\/$/, '') + '/healthz?self=1').catch(() => {});
  setTimeout(pingSelf, 60e3); setInterval(pingSelf, 9 * 60e3); console.log('保活：每 9 分鐘自我探測 ' + SELF_URL);
}
