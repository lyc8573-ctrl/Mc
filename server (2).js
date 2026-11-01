const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool, types } = require('pg');
types.setTypeParser(20, Number); types.setTypeParser(1700, Number);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL ? { rejectUnauthorized: false } : false });
const q = async (s, a) => (await pool.query(s, a)).rows;
const GAME = fs.readFileSync(path.join(__dirname, 'index.html')), ADMIN = fs.readFileSync(path.join(__dirname, 'admin.html'));
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
  for (const c of ['ip TEXT', 'fp TEXT', 'ua TEXT', 'note TEXT', 'ban_reason TEXT', 'banned_at BIGINT', "cmds TEXT DEFAULT '[]'", 'hits BIGINT DEFAULT 0', 'god INTEGER DEFAULT 0']) await q('ALTER TABLE players ADD COLUMN IF NOT EXISTS ' + c).catch(() => {});
  await q('CREATE TABLE IF NOT EXISTS bans(kind TEXT,val TEXT,pid TEXT,reason TEXT,created BIGINT,PRIMARY KEY(kind,val))');
  await q('CREATE TABLE IF NOT EXISTS logs(ts BIGINT,act TEXT,pid TEXT,detail TEXT)');
  await q('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT)');
  await q('CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY,reward TEXT,max_uses INTEGER DEFAULT 0,uses INTEGER DEFAULT 0,expires BIGINT DEFAULT 0,created BIGINT,active INTEGER DEFAULT 1)');
  await q('CREATE TABLE IF NOT EXISTS redeemed(code TEXT,pid TEXT,ts BIGINT,PRIMARY KEY(code,pid))');
})().catch(e => { ready = null; throw e; }));
const banHit = async (pid, gid, ip, fp) => (await q("SELECT kind,pid FROM bans WHERE (kind='pid' AND val IN ($1,$2)) OR (kind='ip' AND val=$3) OR (kind='fp' AND val=$4) LIMIT 1", [pid || '-', gid || '-', ip || '-', fp || '-']))[0] || null;
const UPSERT = 'INSERT INTO players(pid,name,data,em,cards,opened,tier,ip,fp,ua,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT(pid) DO UPDATE SET name=EXCLUDED.name,data=EXCLUDED.data,em=EXCLUDED.em,cards=EXCLUDED.cards,opened=EXCLUDED.opened,tier=CASE WHEN players.god=1 THEN \'神域\' ELSE EXCLUDED.tier END,ip=EXCLUDED.ip,fp=CASE WHEN EXCLUDED.fp<>\'\' THEN EXCLUDED.fp ELSE players.fp END,ua=EXCLUDED.ua,updated=EXCLUDED.updated,hits=COALESCE(players.hits,0)+1';
async function pushCmd(pid, c) {
  const r = (await q('SELECT cmds FROM players WHERE pid=$1', [pid]))[0]; if (!r) return;
  let a = []; try { a = JSON.parse(r.cmds || '[]'); } catch {}
  a.push(...[].concat(c)); await q('UPDATE players SET cmds=$1 WHERE pid=$2', [JSON.stringify(a.slice(-50)), pid]);
}
async function save(req, res) {
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad request' }); }
  const pid = String(b.pid || '');
  if (!/^[\w-]{8,64}$/.test(pid) || !b.data || typeof b.data !== 'object') return send(res, 400, { error: 'bad request' });
  const d = b.data, now = Date.now(), name = String(b.name || '未命名').slice(0, 20);
  const em = Math.floor(Number(d.em)) || 0, cards = Array.isArray(d.cards) ? d.cards.length : 0, opened = Math.floor(Number(d.opened)) || 0;
  const tier = d.eter ? '永恆' : d.prem ? '至尊' : d.vip ? 'VIP' : '普通';
  const fp = b.fp ? sha(String(b.fp).slice(0, 600)).toString('hex').slice(0, 16) : '';
  const ip = ipOf(req), gid = cookie(req, 'gid'), ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const hit = await banHit(pid, gid, ip, fp);
  await q(UPSERT, [pid, name, JSON.stringify(d), em, cards, opened, tier, ip, fp, ua, now]);
  let r = (await q('SELECT banned,ban_reason,cmds,god FROM players WHERE pid=$1', [pid]))[0];
  if (hit && !r.banned) { // 封禁規避：換帳號/清資料但 cookie、IP 或裝置碼仍符合
    const why = '封禁規避（符合 ' + hit.kind + '）';
    await q("INSERT INTO bans(kind,val,pid,reason,created) VALUES('pid',$1,$2,$3,$4) ON CONFLICT(kind,val) DO NOTHING", [pid, hit.pid || pid, why, now]);
    await q('UPDATE players SET banned=1,ban_reason=$1,banned_at=$2 WHERE pid=$3', [why, now, pid]);
    log('evade', pid, why + ' ' + name); r = { banned: 1, ban_reason: why };
  }
  const h = gid ? {} : { 'set-cookie': 'gid=' + pid + '; Max-Age=315360000; Path=/; HttpOnly; SameSite=Lax; Secure' };
  if (r.banned) return send(res, 200, { ok: 1, banned: true, reason: r.ban_reason || '' }, h);
  let cmds = []; try { cmds = JSON.parse(r.cmds || '[]'); } catch {}
  if (cmds.length) await q('UPDATE players SET cmds=$1 WHERE pid=$2 AND cmds=$3', ['[]', pid, r.cmds]);
  const a = (await q("SELECT v FROM kv WHERE k='ann'"))[0];
  send(res, 200, { ok: 1, banned: false, cmds, ann: a ? JSON.parse(a.v) : null, god: r.god ? 1 : 0 }, h);
}
const PKN = ['農場包', '礦工包', '工匠包', '森林包', '沙漠包', '雪原包', '海洋包', '洞穴包', '村莊包', '紅石包', '動物園包', '怪物包', '戰士包', '附魔包', '下界包', '終界包', '傳說包', 'Boss包', '篩界包'];
const descR = r => r.t === 'em' ? '💚' + r.n : r.t === 'up' ? (r.v === 'prem' ? '至尊通行證' : 'VIP 通行證') : (PKN[r.p] || '卡包') + ' ×' + r.n;
const SEED = [ // Roblox 風格常見代碼範本（admin 可一鍵建立）
  ['WELCOME', [{ t: 'em', n: 500 }], 0],
  ['RELEASE', [{ t: 'em', n: 1000 }], 0],
  ['THANKS', [{ t: 'em', n: 300 }, { t: 'pack', p: 0, n: 2 }], 0],
  ['100LIKES', [{ t: 'em', n: 800 }], 0],
  ['FREEGEMS', [{ t: 'em', n: 200 }], 0],
  ['MINERPACK', [{ t: 'pack', p: 1, n: 3 }], 0],
  ['UPDATE1', [{ t: 'em', n: 600 }, { t: 'pack', p: 13, n: 1 }], 0],
  ['1KPLAYERS', [{ t: 'em', n: 1500 }, { t: 'pack', p: 17, n: 1 }], 1000]
];
const rfails = new Map();
async function redeem(req, res) {
  let b; try { b = JSON.parse(await body(req, 10000)); } catch { return send(res, 400, { error: '請求錯誤' }); }
  const ip = ipOf(req), f = rfails.get(ip), now = Date.now();
  if (f && f.n >= 8 && now - f.t < 600000) return send(res, 429, { error: '嘗試太多次，請 10 分鐘後再試' });
  const pid = String(b.pid || ''), code = String(b.code || '').replace(/\s/g, '').toUpperCase().slice(0, 32);
  if (!/^[\w-]{8,64}$/.test(pid) || !code) return send(res, 400, { error: '代碼無效' });
  const pl = (await q('SELECT banned FROM players WHERE pid=$1', [pid]))[0];
  if (!pl) return send(res, 200, { error: '請稍後再試（尚未同步完成）' });
  if (pl.banned) return send(res, 200, { banned: true });
  const c = (await q('SELECT * FROM codes WHERE code=$1', [code]))[0];
  if (!c) { const x = f && now - f.t < 600000 ? f : { n: 0 }; x.n++; x.t = now; rfails.set(ip, x); return send(res, 200, { error: '代碼無效' }); }
  if (!c.active) return send(res, 200, { error: '這組代碼已停用' });
  if (c.expires && c.expires < now) return send(res, 200, { error: '這組代碼已過期' });
  if (!(await q('INSERT INTO redeemed(code,pid,ts) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING code', [code, pid, now])).length) return send(res, 200, { error: '你已經兌換過這組代碼' });
  if (!(await q('UPDATE codes SET uses=uses+1 WHERE code=$1 AND (max_uses=0 OR uses<max_uses) RETURNING uses', [code])).length) {
    await q('DELETE FROM redeemed WHERE code=$1 AND pid=$2', [code, pid]); return send(res, 200, { error: '這組代碼已被兌換完' });
  }
  let rw = []; try { rw = JSON.parse(c.reward); } catch {}
  await pushCmd(pid, rw.map(r => Object.assign({}, r, { q: 1 })));
  log('redeem', pid, code); send(res, 200, { ok: 1, msg: '兌換成功！獲得 ' + rw.map(descR).join('、') });
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
    const r = (await q('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN updated>$1 THEN 1 ELSE 0 END),0) AS online, COALESCE(SUM(CASE WHEN updated>$2 THEN 1 ELSE 0 END),0) AS active24, COALESCE(SUM(CASE WHEN banned=1 THEN 1 ELSE 0 END),0) AS banned, COALESCE(SUM(em),0) AS em, COALESCE(SUM(opened),0) AS opened FROM players', [now - 120000, now - 86400000]))[0];
    r.bans = (await q('SELECT COUNT(*) AS n FROM bans'))[0].n; return send(res, 200, r);
  }
  if (p === '/api/admin/list') {
    const where = [], a = [], qs = (u.searchParams.get('q') || '').toLowerCase(), fl = u.searchParams.get('f');
    if (qs) { a.push('%' + qs + '%'); const n = '$' + a.length; where.push(`(LOWER(name) LIKE ${n} OR LOWER(pid) LIKE ${n} OR LOWER(COALESCE(ip,'')) LIKE ${n})`); }
    if (fl === 'banned') where.push('banned=1'); else if (fl === 'online') { a.push(now - 120000); where.push('updated>$' + a.length); }
    const rows = await q('SELECT pid,name,em,cards,opened,tier,banned,ip,created,updated FROM players' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ' + (SORT[u.searchParams.get('s')] || SORT.recent) + ' LIMIT 300', a);
    return send(res, 200, { players: rows });
  }
  if (p === '/api/admin/player') {
    const pl = (await q('SELECT * FROM players WHERE pid=$1', [u.searchParams.get('pid') || '']))[0];
    if (!pl) return send(res, 404, { error: 'not found' });
    const c = [], a = [pl.pid];
    if (pl.fp) c.push('fp=$' + a.push(pl.fp)); if (pl.ip) c.push('ip=$' + a.push(pl.ip));
    const related = c.length ? await q('SELECT pid,name,banned FROM players WHERE pid<>$1 AND (' + c.join(' OR ') + ') LIMIT 20', a) : [];
    return send(res, 200, { player: pl, related });
  }
  if (p === '/api/admin/bans') return send(res, 200, { bans: await q('SELECT b.kind,b.val,b.pid,b.reason,b.created,p.name FROM bans b LEFT JOIN players p ON p.pid=b.pid ORDER BY b.created DESC LIMIT 300') });
  if (p === '/api/admin/logs') return send(res, 200, { logs: await q('SELECT ts,act,pid,detail FROM logs ORDER BY ts DESC LIMIT 100') });
  if (p === '/api/admin/codes') return send(res, 200, { codes: await q('SELECT code,reward,max_uses,uses,expires,created,active FROM codes ORDER BY created DESC LIMIT 300') });
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
  if (p === '/api/admin/codecreate') {
    let code = String(b.code || '').replace(/\s/g, '').toUpperCase().slice(0, 32);
    if (!code) code = Array.from(crypto.randomBytes(8), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return send(res, 400, { error: '代碼只能用英數字、底線、減號（3~32 字）' });
    const rw = [], em = Math.floor(Number(b.em) || 0), pn = Math.floor(Number(b.pn) || 0);
    if (em) { if (em < 0 || em > 1e9) return send(res, 400, { error: '綠寶石數量不合理' }); rw.push({ t: 'em', n: em }); }
    if (['vip', 'prem'].includes(b.up)) rw.push({ t: 'up', v: b.up });
    if (pn) { const pp = Math.floor(Number(b.p)); if (!(pp >= 0 && pp < PKN.length) || pn < 1 || pn > 50) return send(res, 400, { error: '卡包設定不合理' }); rw.push({ t: 'pack', p: pp, n: pn }); }
    if (!rw.length) return send(res, 400, { error: '請至少設定一種獎勵' });
    const mx = Math.max(0, Math.floor(Number(b.max) || 0)), hrs = Number(b.hours) || 0;
    const ok = await q('INSERT INTO codes(code,reward,max_uses,expires,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING code', [code, JSON.stringify(rw), mx, hrs > 0 ? now + hrs * 3600000 : 0, now]);
    if (!ok.length) return send(res, 400, { error: '這組代碼已存在' });
    log('codeadd', '', code + ' ' + rw.map(descR).join(',')); return send(res, 200, { ok: 1, code });
  }
  if (p === '/api/admin/codeact') {
    const code = String(b.code || '');
    if (b.a === 'toggle') await q('UPDATE codes SET active=1-active WHERE code=$1', [code]);
    else if (b.a === 'delete') { await q('DELETE FROM codes WHERE code=$1', [code]); await q('DELETE FROM redeemed WHERE code=$1', [code]); }
    else return send(res, 400, { error: 'bad act' });
    log('code' + b.a, '', code); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/codeseed') {
    let n = 0;
    for (const [code, rw, mx] of SEED) if ((await q('INSERT INTO codes(code,reward,max_uses,expires,created) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING RETURNING code', [code, JSON.stringify(rw), mx, now])).length) n++;
    log('codeseed', '', '新增 ' + n + ' 組'); return send(res, 200, { ok: 1, n });
  }
  if (p === '/api/admin/announce') {
    const t = String(b.text || '').slice(0, 500);
    if (t) await q('INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v', ['ann', JSON.stringify({ id: now, text: t })]); else await q("DELETE FROM kv WHERE k='ann'");
    log('announce', '', t || '(清除)'); return send(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/broadcast') {
    const c = b.cmd || {};
    if (c.t === 'em') { c.n = Math.floor(Number(c.n)); if (!c.n || Math.abs(c.n) > 1e9) return send(res, 400, { error: 'bad n' }); }
    else if (c.t === 'msg') c.s = String(c.s || '').slice(0, 300); else return send(res, 400, { error: 'bad cmd' });
    const rows = await q('SELECT pid FROM players WHERE banned=0 LIMIT 2000');
    for (const r of rows) await pushCmd(r.pid, c);
    log('broadcast', '', JSON.stringify(c)); return send(res, 200, { ok: 1, n: rows.length });
  }
  if (p !== '/api/admin/act') return send(res, 404, { error: 'not found' });
  const pid = String(b.pid || ''), reason = String(b.reason || '違規').slice(0, 100);
  const add = (kind, val, src) => val && q('INSERT INTO bans(kind,val,pid,reason,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,val) DO UPDATE SET pid=EXCLUDED.pid,reason=EXCLUDED.reason', [kind, val, src, reason, now]);
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
    case 'note': await q('UPDATE players SET note=$1 WHERE pid=$2', [String(b.v || '').slice(0, 300), pid]); break;
    case 'god': { // 神域通行證：只有這裡（管理員）能授予，玩家端每次同步都會被伺服器的值覆蓋
      const v = b.v ? 1 : 0;
      await q('UPDATE players SET god=$1 WHERE pid=$2', [v, pid]);
      if (v) await q("UPDATE players SET tier='神域' WHERE pid=$1", [pid]);
      await pushCmd(pid, { t: 'god', v }); log('god', pid, pl.name + (v ? ' 授予神域' : ' 收回神域')); break;
    }
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
      try { await init(); if (await banHit('', cookie(req, 'gid'), ipOf(req), '')) { res.writeHead(403, { 'content-type': 'text/html;charset=utf-8' }); return res.end(BANPAGE); } } catch (e) { console.error(e); }
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
