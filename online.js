// 伺服器連線層：登入、雲端存檔、活動倍率、公告、指令發放、兌換碼
(() => {
const $ = (t, css, h = '') => { const e = document.createElement(t); e.style.cssText = css || ''; e.innerHTML = h; return e; };
const unboot = () => { const b = document.getElementById('boot'); if (b) b.remove(); };
const DEV = localStorage.getItem('mc_dev') || (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('mc_dev', d); return d; })();
const K = 'mc_account'; let acc = JSON.parse(localStorage.getItem(K) || 'null'), evs = [], off = 0, es, applied = new Set(), dead = false;
const api = (p, o = {}) => fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-token': acc ? acc.key : '' }, body: o.body && JSON.stringify(o.body) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
const full = () => $('div', 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center');
const toast = (t, bg = '#28a745') => { const e = $('div', `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99998;background:${bg};color:#fff;padding:10px 16px;border-radius:10px;max-width:90vw;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:.95rem`, t); document.body.appendChild(e); setTimeout(() => e.remove(), 4500); };
const refresh = () => { try { renderBuffSlots(); renderCurrentCard(); renderCompanies(); renderStocks(); renderFriendList(); updateUI(); } catch (e) { console.error(e); } };

function loginScreen(msg = '') {
  const o = full(); o.innerHTML = `<h1>極簡資本</h1><div style="color:#dc3545">${msg}</div>
  <input id="ln" placeholder="玩家名稱（1~16 字）" maxlength="16" style="padding:10px;font-size:1rem;width:260px;border:1px solid #ccc;border-radius:8px">
  <input id="lk" placeholder="登入金鑰（新玩家免填）" style="padding:10px;font-size:1rem;width:260px;border:1px solid #ccc;border-radius:8px">
  <button class="btn" style="padding:10px 30px;font-size:1rem">進入遊戲</button>`;
  o.querySelector('button').onclick = async () => {
    try { const r = await api('/api/login', { body: { name: o.querySelector('#ln').value, key: o.querySelector('#lk').value, dev: DEV } }); acc = { name: r.name, key: r.key }; localStorage.setItem(K, JSON.stringify(acc)); o.remove(); start(); }
    catch (e) { o.remove(); loginScreen(e.message); }
  };
  document.body.appendChild(o); unboot();
}
function blocked(msg) { dead = true; if (es) es.close(); const o = full(); o.innerHTML = `<h2>${msg}</h2><button class="btn secondary">重新整理</button>`; o.querySelector('button').onclick = () => location.reload(); document.body.appendChild(o); unboot(); }

function apply(c) {
  if (applied.has(c.id)) return; applied.add(c.id);
  if (c.type === 'msg') { toast('💬 管理員：' + c.msg, '#17a2b8'); api('/api/ack', { body: { ids: [c.id] } }).catch(() => {}); return; }
  if (c.type === 'money') state.balance += c.value;
  else if (c.type === 'setmoney') state.balance = c.value;
  else if (c.type === 'card') { state.currentCardLevel = c.value; state.maxCardOwnedLevel = c.value; }
  else if (c.type === 'cores') state.capitalCores = Math.max(0, (state.capitalCores || 0) + c.value);
  else if (c.type === 'rebirth') state.rebirths = Math.max(0, (state.rebirths || 0) + c.value);
  else if (c.type === 'buff') c.ids.forEach(i => state.inventory[i] = (state.inventory[i] || 0) + 1);
  else if (c.type === 'reset') { Object.assign(state, { balance: 0, rebirths: 0, capitalCores: 0, bankDeposit: 0, inventory: {}, equippedBuffs: [], multiplier: 1 }); companies.forEach((x, i) => { x.level = 0; x.cost = Math.floor(300 * Math.pow(1.5, i)); }); stocks.forEach(s => s.owned = 0); }
  state.balance = Math.floor(state.balance); recalcMultiplier(); refresh();
  toast(c.msg || ({ card: '💳 你的卡片已被管理員調整', money: '💰 收到管理員發放的金錢', buff: '✨ 收到 Buff 獎勵', cores: '收到資本核心', rebirth: '重生次數已調整', setmoney: '餘額已被管理員調整', reset: '進度已被管理員重置' })[c.type]);
  save().then(() => api('/api/ack', { body: { ids: [c.id] } })).catch(() => {});
}
const save = () => api('/api/save', { body: { save: getSavePackage() } });

function calcEvents() {
  const t = Date.now() + off; let c = 1, i = 1; const act = evs.filter(e => e.start <= t && e.end > t);
  act.forEach(e => { if (e.type === 'click' || e.type === 'all') c *= e.factor; if (e.type === 'income' || e.type === 'all') i *= e.factor; });
  window.EVENT_CLICK_MULT = c; window.EVENT_INCOME_MULT = i; return act;
}
const bar = $('div', 'position:fixed;top:0;left:0;right:0;z-index:9000;background:#6f42c1;color:#fff;font-size:.8rem;text-align:center;padding:3px;display:none');
let lastM = '';
setInterval(() => { const t = Date.now() + off, act = calcEvents(); const mk = window.EVENT_CLICK_MULT + '/' + window.EVENT_INCOME_MULT; const chg = mk !== lastM; lastM = mk; bar.style.display = act.length ? 'block' : 'none';
  bar.innerHTML = act.map(e => { const s = Math.max(0, Math.floor((e.end - t) / 1000)); return `🎉 ${e.name}${e.type === 'rain' ? '' : ' x' + e.factor} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`; }).join('　'); if (chg) { try { updateUI(); } catch {} } }, 1000);

function connect() {
  es = new EventSource('/api/stream?key=' + encodeURIComponent(acc.key));
  es.addEventListener('hello', e => { const d = JSON.parse(e.data); off = d.now - Date.now(); evs = d.events; });
  es.addEventListener('events', e => { const d = JSON.parse(e.data); off = d.now - Date.now(); evs = d.events; });
  es.addEventListener('cmd', e => apply(JSON.parse(e.data)));
  es.addEventListener('announce', e => { const d = JSON.parse(e.data); toast('📢 ' + d.text, d.style === 'event' ? '#6f42c1' : '#17a2b8'); try { speakText(d.text); } catch {} });
  es.addEventListener('reload', () => api('/api/save').then(r => { if (r.save) { applySavePackage(r.save); refresh(); toast('管理員已回溯你的存檔進度', '#fd7e14'); } }).catch(() => {}));
  es.addEventListener('kick', e => blocked(JSON.parse(e.data).reason));
  es.onerror = () => { if (dead) return; es.close(); setTimeout(() => !dead && connect(), 3000); };
}
function menu() {
  const b = $('button', 'position:fixed;right:12px;bottom:40px;z-index:9001;width:44px;height:44px;border-radius:50%;border:none;background:#f39c12;color:#fff;font-size:1.3rem;box-shadow:0 3px 10px rgba(0,0,0,.3)', '🎁');
  b.onclick = () => { const o = full(); o.style.background = 'rgba(255,255,255,.97)';
    o.innerHTML = `<h3>👤 ${acc.name}</h3><div style="font-size:.8rem;color:#666">登入金鑰（換裝置用，請勿外流）<br><b style="user-select:all">${acc.key}</b></div>
    <input id="cd" placeholder="輸入兌換碼" style="padding:10px;width:240px;border:1px solid #ccc;border-radius:8px"><button class="btn gold" id="rd">兌換</button>
    <button class="btn danger" id="lo">登出</button><button class="btn secondary" id="cl">關閉</button>`;
    o.querySelector('#cl').onclick = () => o.remove();
    o.querySelector('#rd').onclick = () => api('/api/redeem', { body: { code: o.querySelector('#cd').value } }).then(() => { toast('兌換成功'); o.remove(); }).catch(e => toast(e.message, '#dc3545'));
    o.querySelector('#lo').onclick = () => { save().finally(() => { localStorage.removeItem(K); localStorage.removeItem('minimalCapitalSave'); location.reload(); }); };
    document.body.appendChild(o); };
  document.body.append(b, bar);
}
async function start() {
  try {
    const r = await api('/api/save'); if (r.save) { applySavePackage(r.save); refresh(); } else await save();
    unboot(); connect(); menu(); setInterval(() => !dead && save().catch(e => { if (/封鎖|未登入/.test(e.message)) blocked(e.message); else if (/異常/.test(e.message)) api('/api/save').then(r => { if (r.save) { applySavePackage(r.save); refresh(); } toast('偵測到異常數據，已還原為伺服器進度', '#dc3545'); }).catch(() => {}); }), 5000);
    window.addEventListener('pagehide', () => navigator.sendBeacon && 0);
  } catch (e) { if (/封鎖/.test(e.message)) blocked(e.message); else { localStorage.removeItem(K); acc = null; loginScreen(e.message); } }
}
if (acc) api('/api/login', { body: { name: acc.name, key: acc.key, dev: DEV } }).then(start).catch(e => { if (/封鎖/.test(e.message)) return blocked(e.message); acc = null; loginScreen(e.message); }); else loginScreen();
})();
