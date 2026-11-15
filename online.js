// 伺服器連線層：登入、雲端存檔、活動倍率、公告、指令發放、兌換碼
(() => {
const $ = (t, css, h = '') => { const e = document.createElement(t); e.style.cssText = css || ''; e.innerHTML = h; return e; };
const unboot = () => { const b = document.getElementById('boot'); if (b) b.remove(); };
const DEV = localStorage.getItem('mc_dev') || (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('mc_dev', d); return d; })();
let rev = 0, xferBusy = false;
(() => { const st = document.createElement('style'); st.id = 'mc-fab-style'; st.textContent = 'body:has(.overlay[style*="display: block"]) .mc-fab, body:has(.overlay[style*="display: flex"]) .mc-fab { display: none !important; }'; document.head.appendChild(st); })();
const K = 'mc_account';
const readCookie = () => { try { const m = /(?:^|;\s*)mc_acc=([^;]+)/.exec(document.cookie); return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch { return null; } };
const loadAcc = () => { try { const a = JSON.parse(localStorage.getItem(K) || 'null'); if (a && a.name && a.key) return a; } catch {} return readCookie(); };
const storeAcc = a => { try { localStorage.setItem(K, JSON.stringify(a)); localStorage.setItem('mc_lastname', a.name); } catch {} document.cookie = 'mc_acc=' + encodeURIComponent(JSON.stringify(a)) + ';max-age=31536000;path=/;SameSite=Lax'; try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} };
const wipeLocal = () => { // 帳號被刪：先封住遊戲的自動存檔（否則它會馬上把舊進度寫回去），再清除並重新整理
  try { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k) { if (/^minimalCapital|^tutorialCompleted/.test(String(k))) return; return orig.apply(this, arguments); }; } catch {}
  try { Object.keys(localStorage).filter(k => k.startsWith('minimalCapital') || k === 'tutorialCompleted' || k === 'mc_lastname').forEach(k => localStorage.removeItem(k)); } catch {}
  document.cookie = 'mc_acc=;max-age=0;path=/'; if (!wipeLocal.t) wipeLocal.t = setTimeout(() => location.reload(), 2500);
};
const clearAcc = () => { try { localStorage.removeItem(K); } catch {} document.cookie = 'mc_acc=;max-age=0;path=/'; };
let acc = loadAcc(), evs = [], off = 0, es, applied = new Set(), dead = false;
const api = (p, o = {}) => fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-token': acc ? acc.key : '' }, body: o.body && JSON.stringify(o.body) }).catch(() => { const er = new Error('無法連線到伺服器'); er.status = 0; er.data = {}; throw er; }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { const er = new Error(j.error || r.status); er.data = j; er.status = r.status; if (r.status === 410 && j.deleted && acc) { acc = null; clearAcc(); wipeLocal(); dead = true; try { if (es) es.close(); } catch {} blocked('你的帳號已被管理員刪除，本機存檔已清除，頁面即將重新整理'); } throw er; } return j; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitMsg = t => { let b = document.getElementById('boot'); if (!b) { b = $('div', 'position:fixed;inset:0;z-index:100000;background:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:1.1rem;color:#555;text-align:center;padding:20px'); b.id = 'boot'; document.body.appendChild(b); } b.textContent = t; };
const full = () => $('div', 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center');
const toast = (t, bg = '#28a745') => { const e = $('div', `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99998;background:${bg};color:#fff;padding:10px 16px;border-radius:10px;max-width:90vw;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:.95rem`, t); document.body.appendChild(e); setTimeout(() => e.remove(), 4500); };
const refresh = () => { try { state.equippedBuffs = state.equippedBuffs.map(b => buffs[b.id] || b); recalcMultiplier(); renderBuffSlots(); renderCurrentCard(); renderCompanies(); renderStocks(); renderFriendList(); updateUI(); } catch (e) { console.error(e); } };

function loginScreen(msg = '', mode) {
  const o = full(), last = localStorage.getItem('mc_lastname') || ''; mode = mode || 'login';
  const inp = 'padding:10px;font-size:1rem;width:260px;border:1px solid #ccc;border-radius:8px';
  o.innerHTML = `<h1>極簡資本</h1><div style="color:#dc3545;max-width:300px">${msg}</div>
  <input id="ln" placeholder="玩家名稱（1~16 字）" maxlength="16" value="${last.replace(/"/g, '')}" style="${inp}">
  <input id="lp" type="password" placeholder="密碼（4 個字元以上）" maxlength="64" style="${inp}" autocomplete="current-password">
  ${mode === 'register' ? `<input id="lp2" type="password" placeholder="再輸入一次密碼" maxlength="64" style="${inp}">` : ''}
  <button class="btn" id="go" style="padding:10px 30px;font-size:1rem">${mode === 'register' ? '註冊並進入遊戲' : '登入'}</button>
  <a href="#" id="sw" style="font-size:.9rem">${mode === 'register' ? '已有帳號？登入' : '第一次玩？註冊新帳號'}</a>
  <div style="font-size:.75rem;color:#999;max-width:280px">請記住你的密碼。忘記密碼可請管理員重設。</div>`;
  const val = id => (o.querySelector(id) || {}).value || '';
  o.querySelector('#sw').onclick = ev => { ev.preventDefault(); const n = val('#ln'); o.remove(); loginScreen('', mode === 'register' ? 'login' : 'register'); document.getElementById('ln').value = n; };
  const go = async () => {
    const name = val('#ln').trim(), pw = val('#lp');
    const again = (m) => { o.remove(); loginScreen(m, mode); document.getElementById('ln').value = name; };
    if (!name) return again('請輸入名稱'); if (mode === 'register' && pw !== val('#lp2')) return again('兩次輸入的密碼不一致');
    waitMsg('登入中…');
    try { const r = await api('/api/login', { body: { name, pw, register: mode === 'register', dev: DEV } }); acc = { name: r.name, key: r.key }; storeAcc(acc); o.remove(); needPw = !!r.needPw; start(); }
    catch (e) { unboot(); again(e.status === 0 || e.status >= 500 ? '伺服器暫時連不上，請稍後再試' : e.message); }
  };
  o.querySelector('#go').onclick = go; o.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.body.appendChild(o); unboot();
}
let needPw = false;
function pwModal() {
  const o = full(); o.style.background = 'rgba(255,255,255,.98)';
  o.innerHTML = `<h3>${needPw ? '請設定登入密碼' : '修改密碼'}</h3><div style="font-size:.85rem;color:#666;max-width:300px">${needPw ? '設定後，即使被登出或換裝置，也能用「名稱 + 密碼」登入。' : ''}</div>
  ${needPw ? '' : '<input id="po" type="password" placeholder="舊密碼" style="padding:10px;width:240px;border:1px solid #ccc;border-radius:8px">'}
  <input id="pn" type="password" placeholder="新密碼（4 個字元以上）" style="padding:10px;width:240px;border:1px solid #ccc;border-radius:8px"><input id="pn2" type="password" placeholder="再輸入一次" style="padding:10px;width:240px;border:1px solid #ccc;border-radius:8px">
  <button class="btn" id="ok">儲存</button><button class="btn secondary" id="no">${needPw ? '稍後再說' : '取消'}</button>`;
  o.querySelector('#no').onclick = () => o.remove();
  o.querySelector('#ok').onclick = () => { const n = o.querySelector('#pn').value; if (n !== o.querySelector('#pn2').value) return toast('兩次密碼不一致', '#dc3545'); api('/api/setpw', { body: { pw: n, old: (o.querySelector('#po') || {}).value } }).then(() => { needPw = false; toast('密碼已儲存'); o.remove(); }).catch(e => toast(e.message, '#dc3545')); };
  document.body.appendChild(o);
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
  else if (c.type === 'reset') { Object.assign(state, { balance: 0, rebirths: 0, capitalCores: 0, bankDeposit: 0, inventory: {}, equippedBuffs: [], multiplier: 1, btnOwned: 0, btnSel: 0, currentCardLevel: 0, maxCardOwnedLevel: 0, cardStars: [], cardAwake: [], codex: [], stats: { clicks: 0 } }); companies.forEach((x, i) => { x.level = 0; x.cost = Math.floor(300 * Math.pow(1.5, i)); }); stocks.forEach(s => s.owned = 0); }
  state.balance = Math.floor(Math.max(0, state.balance)); recalcMultiplier(); refresh();
  toast(c.msg || ({ card: '💳 你的卡片已被管理員調整', money: '💰 收到管理員發放的金錢', buff: '✨ 收到 Buff 獎勵', cores: '收到資本核心', rebirth: '重生次數已調整', setmoney: '餘額已被管理員調整', reset: '進度已被管理員重置' })[c.type]);
  save().then(() => api('/api/ack', { body: { ids: [c.id] } })).catch(() => {});
}
const save = () => api('/api/save', { body: { save: getSavePackage(), rev } }).then(r => { if (r && r.rev !== undefined) rev = Math.max(rev, r.rev); return r; });
const resync = () => api('/api/save').then(r => { if (r.save) { applySavePackage(r.save); refresh(); } rev = r.rev || 0; toast('帳號進度已同步為伺服器最新版本', '#fd7e14'); }).catch(() => {});

function calcEvents() {
  const t = Date.now() + off; let c = 1, i = 1; const act = evs.filter(e => e.start <= t && e.end > t);
  act.forEach(e => { if (e.type === 'click' || e.type === 'all') c *= e.factor; if (e.type === 'income' || e.type === 'all') i *= e.factor; });
  window.EVENT_CLICK_MULT = c; window.EVENT_INCOME_MULT = i; return act;
}
const bar = $('div', 'position:fixed;top:0;left:0;right:0;z-index:9000;background:#6f42c1;color:#fff;font-size:.8rem;text-align:center;padding:3px;display:none');
let lastM = '';
setInterval(() => { const t = Date.now() + off, act = calcEvents(); const mk = window.EVENT_CLICK_MULT + '/' + window.EVENT_INCOME_MULT; const chg = mk !== lastM; lastM = mk; bar.style.display = act.length ? 'block' : 'none';
  bar.innerHTML = act.map(e => { const s = Math.max(0, Math.floor((e.end - t) / 1000)); return `🎉 ${e.name}${['click', 'income', 'all'].includes(e.type) ? ' x' + e.factor : ''} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`; }).join('　'); if (chg) { try { updateUI(); } catch {} } }, 1000);

function connect() {
  es = new EventSource('/api/stream?key=' + encodeURIComponent(acc.key));
  es.addEventListener('hello', e => { const d = JSON.parse(e.data); off = d.now - Date.now(); evs = d.events; });
  es.addEventListener('events', e => { const d = JSON.parse(e.data); off = d.now - Date.now(); evs = d.events; });
  es.addEventListener('market', e => { const d = JSON.parse(e.data); try {
    stocks.forEach((s, i) => { s.price = d.p[i]; if (d.h) s.history = d.h[i].slice(); else { s.history.push(s.price); s.history.shift(); } });
    drawChart(); renderStocks(); } catch (err) {} });
  es.addEventListener('cmd', e => apply(JSON.parse(e.data)));
  es.addEventListener('announce', e => { const d = JSON.parse(e.data); toast('📢 ' + d.text, d.style === 'event' ? '#6f42c1' : '#17a2b8'); try { speakText(d.text); } catch {} });
  es.addEventListener('reload', () => api('/api/save').then(r => { rev = r.rev || 0; if (r.save) { applySavePackage(r.save); refresh(); toast('管理員已回溯你的存檔進度', '#fd7e14'); } }).catch(() => {}));
  es.addEventListener('packet', e => { const d = JSON.parse(e.data); const t = $('div', 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99997;background:#dc3545;color:#fff;padding:12px 16px;border-radius:12px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.35)', `🧧 ${d.name}<br><small>限量 ${d.left} 份，手快有！</small><br>`);
    const b = $('button', 'margin-top:6px;padding:8px 22px;border:0;border-radius:8px;background:#ffc107;font-weight:bold;font-size:1rem', '搶紅包'); b.onclick = () => { b.disabled = true; api('/api/claim', { body: { id: d.id } }).then(() => { t.remove(); }).catch(er => { toast(er.message, '#6c757d'); t.remove(); }); }; t.appendChild(b); document.body.appendChild(t); setTimeout(() => t.remove(), 60000); });
  es.addEventListener('friends', () => loadFriends());
  es.addEventListener('kp', () => kpLoad()); es.addEventListener('events', () => kpRender());
  es.addEventListener('dm', e => { const d = JSON.parse(e.data); if (chatWith && chatWith.id === d.from) loadChat(); else { toast(`💬 ${d.name}：${d.text.slice(0, 40)}`, '#0d6efd'); loadFriends(); } });
  es.addEventListener('kick', e => { const d = JSON.parse(e.data); if (d.wipe) { clearAcc(); wipeLocal(); } blocked(d.reason); });
  es.onerror = () => { if (dead) return; es.close(); setTimeout(() => !dead && connect(), 3000); };
}

// ================= 好友中心（伺服器版）=================
let FD = { friends: [], incoming: [], outgoing: [] }, fq = '', chatWith = null, chatBox = null;
const fm = n => { try { return formatMoney(n); } catch { return Number(n).toLocaleString(); } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const btn = (t, f, bg = '#0d6efd') => { const b = $('button', `padding:5px 9px;border:0;border-radius:7px;background:${bg};color:#fff;font-size:.8rem;cursor:pointer`, t); b.onclick = f; return b; };
async function loadFriends() { try { FD = await api('/api/friends'); drawFriends(); } catch {} }
const act = (p, body, ok) => api(p, { body }).then(() => { if (ok) toast(ok); return loadFriends(); }).catch(e => toast(e.message, '#dc3545'));
function drawFriends() {
  const root = document.getElementById('fx-list'); if (!root) return; root.innerHTML = '';
  const sec = (t) => root.appendChild($('div', 'font-weight:bold;margin:6px 0 2px;font-size:.9rem', t));
  if (FD.incoming.length) { sec(`📨 好友邀請（${FD.incoming.length}）`);
    FD.incoming.forEach(r => { const d = $('div', 'display:flex;gap:6px;align-items:center;background:#fff8e1;padding:8px;border-radius:10px;margin-bottom:4px', `<b style="flex:1">${esc(r.name)}</b>`); d.append(btn('接受', () => act('/api/friends/respond', { id: r.id, accept: true }, '已成為好友'), '#28a745'), btn('拒絕', () => act('/api/friends/respond', { id: r.id, accept: false }), '#6c757d')); root.appendChild(d); }); }
  const list = FD.friends.filter(f => (f.nick + f.name).toLowerCase().includes(fq)).sort((a, b) => b.fav - a.fav || b.online - a.online || (a.nick || a.name).localeCompare(b.nick || b.name, 'zh-Hant'));
  sec(`👥 好友（${FD.friends.filter(f => f.online).length} 在線 / ${FD.friends.length}）`);
  if (!FD.friends.length) root.appendChild($('div', 'color:#999;text-align:center;padding:16px;border:1px dashed #ddd;border-radius:10px;font-size:.88rem', '還沒有好友。輸入對方的玩家名稱送出邀請吧！'));
  list.forEach(f => {
    const c = $('div', 'background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:10px;margin-bottom:6px;display:flex;flex-direction:column;gap:6px');
    c.innerHTML = `<div style="display:flex;align-items:center;gap:6px"><span style="color:${f.online ? '#28a745' : '#bbb'};font-size:1.1rem">●</span><b style="flex:1;overflow-wrap:anywhere">${f.fav ? '⭐ ' : ''}${esc(f.nick || f.name)}${f.nick ? ` <small style="color:#999">(${esc(f.name)})</small>` : ''}</b><small style="color:#888">${f.online ? '在線' : '離線'}</small></div>
    <div style="font-size:.75rem;color:#777">重生 ${f.rebirths}｜最高卡片 Lv.${f.card}｜資產 $${fm(f.wealth)}｜${f.online ? '' : '最後上線 ' + new Date(f.lastSeen).toLocaleString('zh-TW') + '｜'}好友自 ${new Date(f.since).toLocaleDateString('zh-TW')}</div>`;
    const row = $('div', 'display:flex;gap:5px;flex-wrap:wrap');
    const chat = btn(`💬 聊天${f.unread ? ` (${f.unread})` : ''}`, () => openChat(f), f.unread ? '#dc3545' : '#0d6efd');
    row.append(chat, btn('💸 轉帳', () => { const v = prompt(`轉帳給 ${f.nick || f.name}（金額）：`); if (!v) return; const n = Math.floor(Number(v)); if (!(n >= 1)) return toast('金額錯誤', '#dc3545'); if (n > state.balance) return toast('你的現金不足', '#dc3545'); if (!confirm(`確定轉 $${fm(n)} 給 ${f.nick || f.name}？`)) return; xferBusy = true; save().catch(() => {}).then(() => api('/api/friends/send', { body: { id: f.id, amount: n } })).then(r => { state.balance = Math.max(0, state.balance - n); rev = r.rev; refresh(); toast(`轉帳成功：$${fm(n)} → ${f.nick || f.name}`); return save().catch(() => {}); }).catch(e => toast(e.message, '#dc3545')).finally(() => { xferBusy = false; }); }, '#28a745'),
      btn(f.fav ? '★ 取消收藏' : '☆ 收藏', () => act('/api/friends/meta', { id: f.id, fav: !f.fav }), '#fd7e14'),
      btn('✏ 暱稱', () => { const n = prompt('好友暱稱（留空=恢復原名）：', f.nick || ''); if (n !== null) act('/api/friends/meta', { id: f.id, nick: n }); }, '#6c757d'),
      btn('🗑 刪除', () => { if (confirm(`刪除好友「${f.nick || f.name}」？聊天紀錄也會一併刪除。`)) act('/api/friends/remove', { id: f.id }); }, '#dc3545'));
    c.appendChild(row); root.appendChild(c);
  });
  if (FD.outgoing.length) { sec(`⏳ 已送出的邀請（${FD.outgoing.length}）`); FD.outgoing.forEach(r => { const d = $('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;color:#666;font-size:.85rem', `<span style="flex:1">${esc(r.name)}（等待回應）</span>`); d.appendChild(btn('撤回', () => act('/api/friends/cancel', { id: r.id }), '#6c757d')); root.appendChild(d); }); }
  const cnt = document.getElementById('fx-badge'); if (cnt) cnt.textContent = FD.incoming.length ? `（${FD.incoming.length} 則新邀請）` : '';
}
function openChat(f) {
  chatWith = f; if (chatBox) chatBox.remove();
  chatBox = full(); chatBox.style.cssText += ';background:rgba(0,0,0,.45);padding:0'; const card = $('div', 'background:#fff;width:min(440px,100vw);height:min(560px,100vh);border-radius:14px;display:flex;flex-direction:column;overflow:hidden');
  card.innerHTML = `<div style="padding:10px 14px;background:#0d6efd;color:#fff;display:flex;justify-content:space-between;align-items:center"><b>💬 ${esc(f.nick || f.name)} <small>${f.online ? '● 在線' : '離線'}</small></b></div><div id="cx-msgs" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;background:#f4f6f9"></div>
  <div style="display:flex;gap:6px;padding:8px;border-top:1px solid #eee"><input id="cx-in" maxlength="200" placeholder="輸入訊息…" style="flex:1;padding:9px;border:1px solid #ccc;border-radius:8px"></div>`;
  const close = btn('關閉', () => { chatBox.remove(); chatBox = null; chatWith = null; loadFriends(); }, '#6c757d'); const send = btn('傳送', () => sendChat(), '#0d6efd'); card.lastElementChild.append(send, close);
  chatBox.appendChild(card); document.body.appendChild(chatBox); card.querySelector('#cx-in').onkeydown = e => { if (e.key === 'Enter') sendChat(); }; loadChat();
}
async function loadChat() { if (!chatWith) return; try { const r = await api('/api/chat?with=' + chatWith.id); const box = document.getElementById('cx-msgs'); if (!box) return;
  box.innerHTML = r.msgs.map(m => { const mine = m.f !== chatWith.id; return `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:80%;background:${mine ? '#0d6efd' : '#fff'};color:${mine ? '#fff' : '#222'};padding:7px 10px;border-radius:12px;overflow-wrap:anywhere;box-shadow:0 1px 2px rgba(0,0,0,.08)">${esc(m.m)}<div style="font-size:.65rem;opacity:.6;margin-top:2px">${new Date(m.t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</div></div>`; }).join('') || '<div style="color:#999;text-align:center;margin-top:30px">還沒有訊息，打個招呼吧 👋</div>'; box.scrollTop = box.scrollHeight; } catch {} }
async function sendChat() { const i = document.getElementById('cx-in'); if (!i || !i.value.trim() || !chatWith) return; const t = i.value; i.value = ''; try { await api('/api/chat', { body: { to: chatWith.id, text: t } }); loadChat(); } catch (e) { toast(e.message, '#dc3545'); i.value = t; } }
function friendsInit() {
  const old = document.getElementById('friend-list-container'); if (!old) return; const box = old.closest('.list-item'); if (!box) return;
  const p2p = [...document.querySelectorAll('.list-item')].find(e => e.textContent.includes('P2P 跨裝置轉帳')); if (p2p) p2p.style.display = 'none'; // 改用伺服器轉帳，避免未驗證的 P2P 轉帳
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><strong>我的玩家名稱：${esc(acc.name)}</strong> <span id="fx-badge" style="color:#dc3545;font-size:.8rem"></span><div style="font-size:.78rem;color:#888;margin-top:2px">把名稱告訴朋友，或輸入對方名稱送出好友邀請</div></div></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap"><input id="fx-name" class="bank-input" style="flex:2;min-width:150px;text-align:left" placeholder="輸入對方玩家名稱" maxlength="16" autocomplete="off"><button class="btn gold" id="fx-add" style="white-space:nowrap">＋ 送出好友邀請</button></div>
  <input id="fx-q" type="search" class="bank-input" style="text-align:left" placeholder="搜尋好友…"><div id="fx-list"></div>`;
  box.querySelector('#fx-add').onclick = () => { const n = box.querySelector('#fx-name'); if (!n.value.trim()) return; act('/api/friends/request', { name: n.value.trim() }, '邀請已送出').then(() => n.value = ''); };
  box.querySelector('#fx-q').oninput = e => { fq = e.target.value.trim().toLowerCase(); drawFriends(); };
  loadFriends(); setInterval(() => !dead && loadFriends(), 15000);
}

['generateQRTransfer', 'startQRScan', 'processScannedQRCode', 'quickPayFriend'].forEach(n => { window[n] = () => toast('已改為伺服器轉帳，請到好友中心使用「轉帳」', '#6c757d'); });

// ================= 賽季與排行榜 =================
let lbBoard = 'season', lbTimer = null, lbTick = null;
function lbInit() {
  const b = $('button', 'position:fixed;right:12px;bottom:92px;z-index:9001;width:44px;height:44px;border-radius:50%;border:none;background:#6f42c1;color:#fff;font-size:1.3rem;box-shadow:0 3px 10px rgba(0,0,0,.3)', '🏆');
  b.className = 'mc-fab'; b.onclick = openLb; document.body.appendChild(b);
}
function openLb() {
  const o = full(); o.style.cssText += ';justify-content:flex-start;padding:0;gap:0;background:#f4f6f9;text-align:left;align-items:stretch;overflow-y:auto';
  o.innerHTML = `<div style="background:#6f42c1;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2"><b style="font-size:1.1rem">🏆 排行榜</b><button id="lbx" style="background:#fff3;border:0;color:#fff;padding:6px 14px;border-radius:8px;font-size:1rem">關閉</button></div>
  <div id="lbt" style="display:flex;gap:6px;padding:10px 10px 4px;overflow-x:auto;flex-shrink:0"></div><div id="lbi" style="padding:6px 12px"></div><div id="lbl" style="padding:0 10px 90px"></div>
  <div id="lbm" style="position:sticky;bottom:0;background:#fff;border-top:1px solid #ddd;padding:10px 16px;font-weight:bold;display:none"></div>`;
  const close = () => { clearInterval(lbTimer); clearInterval(lbTick); o.remove(); }; o.querySelector('#lbx').onclick = close;
  const tabs = [['season', '🏆 賽季榜'], ['wealth', '💰 財富榜'], ['rebirths', '🔄 重生榜'], ['cores', '💎 核心榜'], ['card', '💳 卡片榜']];
  const drawTabs = () => { const t = o.querySelector('#lbt'); t.innerHTML = ''; tabs.forEach(([k, n]) => { const b = $('button', `border:0;border-radius:18px;padding:7px 14px;white-space:nowrap;font-size:.9rem;background:${k === lbBoard ? '#6f42c1' : '#fff'};color:${k === lbBoard ? '#fff' : '#555'};box-shadow:0 1px 3px rgba(0,0,0,.12)`, n); b.onclick = () => { lbBoard = k; drawTabs(); load(); }; t.appendChild(b); }); };
  let data = null; const sc = d => (n) => ['rebirths', 'card'].includes(d.metric) ? String(n) : fm(n);
  const left = e => { const s = Math.max(0, Math.floor((e - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${d ? d + ' 天 ' : ''}${h} 小時 ${m} 分`; };
  const draw = () => {
    if (!data) return; const d = data, f = sc(d), info = o.querySelector('#lbi'), list = o.querySelector('#lbl'), me = o.querySelector('#lbm');
    let h = '';
    if (d.board === 'season') {
      if (d.season) h += `<div style="background:#fff;border-radius:12px;padding:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)"><b>${esc(d.season.name)}</b><div style="font-size:.85rem;color:#555;margin-top:4px">排名依據：${esc(d.season.metricName)}<br>剩餘時間：<b id="lbc">${left(d.season.end)}</b><br>前 ${d.season.n} 名可獲得獎勵：第 1 名 ${esc(d.season.prize)}（第 2 名一半、第 3 名四分之一、其餘十分之一）</div></div>`;
      else h += `<div style="background:#fff;border-radius:12px;padding:14px;text-align:center;color:#888">目前沒有進行中的賽季，敬請期待！</div>`;
    }
    if (d.last && d.board === 'season') h += `<div style="font-size:.8rem;color:#777;margin-top:8px">上一賽季「${esc(d.last.name)}」：${d.last.top.map((x, i) => ['👑', '🥈', '🥉'][i] + esc(x.name)).join('　')}</div>`;
    if (d.hidden) h += `<div style="font-size:.8rem;color:#dc3545;margin-top:6px">你目前被管理員從排行榜隱藏</div>`;
    info.innerHTML = h;
    list.innerHTML = d.top.map(x => `<div style="display:flex;align-items:center;gap:8px;padding:10px;margin-top:6px;border-radius:10px;background:${x.me ? '#e8defb' : '#fff'};box-shadow:0 1px 3px rgba(0,0,0,.07)"><b style="width:34px;text-align:center;font-size:${x.rank <= 3 ? '1.3rem' : '1rem'}">${['🥇', '🥈', '🥉'][x.rank - 1] || x.rank}</b><span style="flex:1;overflow-wrap:anywhere">${x.crown ? x.crown + ' ' : ''}${esc(x.name)}${x.online ? ' <span style="color:#28a745;font-size:.7rem">●</span>' : ''}</span><b>${f(x.score)}</b></div>`).join('') || '<div style="text-align:center;color:#999;padding:30px">還沒有人上榜</div>';
    me.style.display = 'block'; me.innerHTML = d.me ? `你的排名：第 <span style="color:#6f42c1;font-size:1.2rem">${d.me.rank}</span> 名 / ${d.total} 人　${f(d.me.score)}` : '你目前未上榜' + (d.board === 'season' && d.season ? '（遊玩後會自動加入賽季排名）' : '');
  };
  const load = async () => { try { data = await api('/api/leaderboard?board=' + lbBoard); draw(); } catch (e) { toast(e.message, '#dc3545'); } };
  drawTabs(); load(); lbTimer = setInterval(load, 15000);
  lbTick = setInterval(() => { const c = o.querySelector('#lbc'); if (c && data && data.season) c.textContent = left(data.season.end); }, 30000);
  document.body.appendChild(o);
}

// ================= KUN Pay 錢包頁（企業頁左邊）=================
(() => { const st = document.createElement('style'); st.textContent = `
.kp-hero{background:linear-gradient(135deg,#2b2b2b,#000);color:#fff;padding:20px 18px 56px;border-radius:0 0 26px 26px}
.kp-card{background:#fff;margin:-36px 14px 0;border-radius:16px;padding:14px 6px;box-shadow:0 4px 14px rgba(0,0,0,.1);display:grid;grid-template-columns:repeat(4,1fr);gap:14px 0;position:relative}
.kp-act{display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:0;font-size:.74rem;color:#333;cursor:pointer;padding:2px 0}
.kp-act i{font-style:normal;width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;background:#eee;color:#111}
.kp-sec{margin:20px 14px 0}.kp-sec h4{margin:0 0 8px;font-size:1rem;display:flex;justify-content:space-between;align-items:center;color:#222}
.kp-ban{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}.kp-ban div{flex:0 0 210px;border-radius:14px;padding:12px;color:#fff;font-size:.85rem;line-height:1.45}
.kp-cp{display:flex;background:#fff;border-radius:14px;margin-bottom:10px;box-shadow:0 1px 5px rgba(0,0,0,.08);overflow:hidden}
.kp-ci{width:70px;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--c);color:#fff;flex-shrink:0}
.kp-cb{flex:1;padding:10px;min-width:0;border-left:2px dashed #ddd;color:#222}.kp-cb small{color:#777;display:block;margin-top:2px}.kp-pr{color:#e67e22;font-weight:bold;margin-top:4px}
.kp-ca{display:flex;flex-direction:column;gap:6px;justify-content:center;padding:8px}
.kp-b{border:0;border-radius:8px;padding:7px 10px;font-size:.8rem;color:#fff;background:#111;cursor:pointer;white-space:nowrap}.kp-b.g{background:#fd7e14}.kp-b.s{background:#6c757d}
.kp-h{display:flex;gap:10px;align-items:center;background:#fff;border-radius:12px;padding:10px;margin-bottom:6px;color:#222}
.kp-empty{color:#999;text-align:center;padding:16px;border:1px dashed #ddd;border-radius:12px;font-size:.88rem;background:#fff}`; document.head.appendChild(st); })();
let KP = { shop: [], coupons: [], hist: [] }, kpBusy = false;
const cn = n => { try { return fmtCN(n); } catch { return fm(n); } };
const kb = n => (Number(n) >= 1e8 ? cn(n) : fm(n));
const ICONS = {
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.8 0 4.5 2 4.5 5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2.5l2.2 11h10.5l2-8H6.5"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8C10 8 8 7 8 5.5S10 3 12 8c2-5 4-3.5 4-2.5S14 8 12 8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  diamond: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16M15 4l-3 16"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>'
};
const ic = (n, sz = 24) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.2em;flex-shrink:0">${ICONS[n] || ICONS.receipt}</svg>`;
const cpIc = k => /^cash/.test(k) ? 'cash' : /^core/.test(k) ? 'diamond' : 'sparkle';
const ds = n => { try { return BigInt(Math.floor(n)).toString(); } catch { return String(Math.floor(n)); } };
const numOf = s => Math.floor(Number(String(s || '').replace(/[,\s$]/g, '')));
const kbtn = (t, f, bg = '#111', ex = '') => { const b = $('button', `border:0;border-radius:10px;padding:11px 14px;background:${bg};color:#fff;font-size:.95rem;cursor:pointer;${ex}`, t); b.onclick = f; return b; };
const sheet = (title, onClose) => {
  const o = full(); o.style.cssText += ';background:rgba(0,0,0,.5);justify-content:flex-end;padding:0;gap:0;align-items:center;z-index:99990';
  const c = $('div', 'background:#fff;width:min(480px,100vw);max-height:90vh;overflow-y:auto;border-radius:18px 18px 0 0;padding:16px 16px 22px;text-align:left;display:flex;flex-direction:column;gap:10px;color:#222');
  const close = () => { try { onClose && onClose(); } catch {} o.remove(); };
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:1.1rem">${title}</b><button class="kp-x" style="border:0;background:#eee;border-radius:50%;width:30px;height:30px;font-size:1rem;cursor:pointer">✕</button></div>`;
  c.querySelector('.kp-x').onclick = close; o.onclick = e => { if (e.target === o) close(); };
  o.appendChild(c); document.body.appendChild(o); return { o, c, close };
};
const IN = 'padding:12px;font-size:1.15rem;border:1px solid #ccc;border-radius:10px;text-align:center;width:100%';
const parseCode = s => {
  s = String(s || '').trim(); const m = /^KUNPAY1\|([^|]*)\|?(\d*)$/.exec(s);
  if (m) { let name = ''; try { name = decodeURIComponent(m[1]); } catch { return null; } const a = Number(m[2] || 0); return name ? { name, amount: Number.isFinite(a) ? a : 0 } : null; }
  if (s && s.length <= 16 && !/^(MIGRATE:|https?:)/i.test(s)) return { name: s, amount: 0 };
  return null;
};
const metaOf = k => KP.shop.find(s => s.k === k);
const firstId = k => (KP.coupons.find(c => c.k === k) || {}).id;
const kpGo = id => { const e = document.getElementById(id); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
async function kpLoad() { try { const r = await api('/api/kunpay'); KP = r; kpRender(); } catch {} }
function kpBal() { const e = document.getElementById('kp-bal'); if (!e || typeof state === 'undefined') return; const n = state.balance; e.textContent = '$' + kb(n); const x = document.getElementById('kp-ex'); if (x) x.textContent = n >= 1e8 ? '$' + fm(n) : ''; }
function kpRender() {
  const root = document.getElementById('panel-kunpay'); if (!root || !acc) return;
  const sc = root.scrollTop, t = Date.now() + off, grads = ['#6f42c1,#a55eea', '#ff7a18,#ffb347', '#0d6efd,#4facfe', '#e6005c,#ff6f91'];
  const evDesc = e => ({ click: `點擊收益 ×${e.factor}`, income: `企業收益 ×${e.factor}`, all: `全收益 ×${e.factor}`, rain: '金錢雨發放中', droprain: '獎勵雨發放中', lottery: '抽獎活動', packet: '搶紅包', login: '登入禮', contest: '資產競賽', market: `股市行情 ×${e.factor}` })[e.type] || '限時活動';
  const banners = ['<div style="background:linear-gradient(135deg,#2b2b2b,#000)"><b>KUN Pay</b><br>掃碼付款、轉帳給朋友、買券送好友</div>'].concat((evs || []).filter(e => e.end > t).slice(0, 6).map((e, i) => `<div style="background:linear-gradient(135deg,${grads[i % 4]})"><b>${esc(e.name)}</b><br>${evDesc(e)}${e.start > t ? '（即將開始）' : ''}</div>`)).join('');
  const acts = [['scan', '掃碼付款', 'scan'], ['qr', '收款碼', 'recv'], ['send', '轉帳', 'xfer'], ['users', '好友', 'friends'], ['cart', '買優惠券', 'shop'], ['ticket', '我的優惠券', 'mine'], ['gift', '送優惠券', 'gift'], ['receipt', '交易紀錄', 'hist']];
  const groups = {}; KP.coupons.forEach(c => (groups[c.k] = groups[c.k] || []).push(c));
  const shopH = KP.shop.map(s => `<div class="kp-cp" style="--c:${s.color}"><div class="kp-ci">${ic(cpIc(s.k), 30)}</div><div class="kp-cb"><b>${esc(s.name)}</b><small>${esc(s.desc)}</small><div class="kp-pr">$${cn(s.price)}</div></div><div class="kp-ca"><button class="kp-b" data-a="buy" data-k="${s.k}">購買</button><button class="kp-b g" data-a="buyto" data-k="${s.k}">買來送朋友</button></div></div>`).join('') || '<div class="kp-empty">商店載入中…</div>';
  const mineH = Object.entries(groups).map(([k, arr]) => { const s = metaOf(k); if (!s) return ''; const from = arr.find(x => x.from); return `<div class="kp-cp" style="--c:${s.color}"><div class="kp-ci">${ic(cpIc(s.k), 30)}</div><div class="kp-cb"><b>${esc(s.name)} ×${arr.length}</b><small>${esc(s.desc)}</small>${from ? `<small>來自 ${esc(from.from)} 的贈禮</small>` : ''}</div><div class="kp-ca"><button class="kp-b" data-a="use" data-k="${k}">使用</button><button class="kp-b g" data-a="giveto" data-k="${k}">送朋友</button></div></div>`; }).join('') || '<div class="kp-empty">你還沒有優惠券。到上方商店購買，或請朋友送你！</div>';
  const HI = { pay: 'send', recv: 'cash', buy: 'cart', giftout: 'gift', giftin: 'gift', use: 'ticket' };
  const histH = (KP.hist || []).slice(0, 20).map(h => `<div class="kp-h"><span style="color:#111;display:flex">${ic(HI[h.k] || 'receipt', 24)}</span><div style="flex:1;min-width:0"><div style="overflow-wrap:anywhere">${esc(h.text)}</div><small style="color:#999">${new Date(h.t).toLocaleString('zh-TW')}</small></div>${h.sign ? `<b style="color:${h.sign > 0 ? '#119b53' : '#d93636'};white-space:nowrap">${h.sign > 0 ? '+' : '-'}$${cn(h.amt)}</b>` : ''}</div>`).join('') || '<div class="kp-empty">還沒有 KUN Pay 交易</div>';
  root.innerHTML = `<div class="kp-hero"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:1.25rem">KUN Pay</b><span style="font-size:.85rem;opacity:.9">${ic('user', 16)} ${esc(acc.name)}</span></div><div style="margin-top:14px;font-size:.85rem;opacity:.9">錢包餘額</div><div id="kp-bal" style="font-size:2.1rem;font-weight:900;overflow-wrap:anywhere"></div><div id="kp-ex" style="font-size:.72rem;opacity:.85;overflow-wrap:anywhere"></div></div>
  <div class="kp-card">${acts.map(a => `<button class="kp-act" data-a="${a[2]}"><i>${ic(a[0], 26)}</i>${a[1]}</button>`).join('')}</div>
  <div class="kp-sec"><h4><span style="display:flex;gap:6px;align-items:center">${ic('sparkle', 18)}活動優惠</span></h4><div class="kp-ban">${banners}</div></div>
  <div class="kp-sec" id="kp-shop"><h4><span style="display:flex;gap:6px;align-items:center">${ic('cart', 18)}優惠券商店</span></h4>${shopH}</div>
  <div class="kp-sec" id="kp-mine"><h4><span style="display:flex;gap:6px;align-items:center">${ic('ticket', 18)}我的優惠券</span> <button class="kp-b g" data-a="gift">送優惠券</button></h4>${mineH}</div>
  <div class="kp-sec" id="kp-hist"><h4><span style="display:flex;gap:6px;align-items:center">${ic('receipt', 18)}交易紀錄</span></h4>${histH}</div>`;
  kpBal(); root.scrollTop = sc;
}
async function pickFriend(title, cb) {
  await loadFriends(); const s = sheet(title);
  if (!FD.friends.length) s.c.appendChild($('div', 'color:#999;text-align:center;padding:18px', '還沒有好友。先到好友中心送出好友邀請吧！'));
  FD.friends.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.online ? 1 : 0) - (a.online ? 1 : 0)).forEach(f => {
    const b = $('button', 'display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e8e8e8;background:#fff;border-radius:12px;padding:12px;font-size:1rem;text-align:left;cursor:pointer', `<span>${f.fav ? '⭐ ' : ''}${esc(f.nick || f.name)}${f.nick ? ` <small style="color:#999">(${esc(f.name)})</small>` : ''}</span><span style="color:${f.online ? '#28a745' : '#bbb'}">●</span>`);
    b.onclick = () => { s.close(); cb(f); }; s.c.appendChild(b);
  });
}
function kpDone(to, amt) {
  const o = full(); o.style.cssText += ';background:linear-gradient(160deg,#2b2b2b,#000);color:#fff;z-index:99990';
  o.innerHTML = `<div>${ic('check', 84)}</div><h2>付款成功</h2><div>已付款給 <b>${esc(to)}</b></div><div style="font-size:2.2rem;font-weight:900;overflow-wrap:anywhere;max-width:92vw">$${fm(amt)}</div><div style="opacity:.85">約 ${cn(amt)}</div>`;
  o.appendChild(kbtn('完成', () => o.remove(), '#fff', 'color:#111;padding:12px 44px;font-weight:bold;margin-top:8px')); document.body.appendChild(o);
}
async function kpPay(name, amt) {
  if (kpBusy) return; if (!(amt >= 1)) return toast('金額錯誤', '#dc3545'); if (amt > state.balance) return toast('你的現金不足', '#dc3545');
  kpBusy = true; xferBusy = true;
  try { await save().catch(() => {}); const r = await api('/api/kunpay/pay', { body: { to: name, amount: amt } }); state.balance = Math.max(0, state.balance - r.amount); rev = r.rev; refresh(); kpDone(r.to, r.amount); save().catch(() => {}); kpLoad(); }
  catch (e) { toast(e.message, '#dc3545'); } finally { kpBusy = false; xferBusy = false; }
}
function kpPayDialog(name, amount) {
  const s = sheet(`付款給 ${esc(name)}`);
  s.c.insertAdjacentHTML('beforeend', `<div style="color:#666;font-size:.9rem">你的餘額：$${kb(state.balance)}${amount ? '　（收款方指定金額）' : ''}</div><input id="kp-amt" inputmode="numeric" placeholder="輸入金額" value="${amount ? ds(amount) : ''}" ${amount ? 'readonly' : ''} style="${IN}"><div id="kp-amt-s" style="text-align:center;color:#111;min-height:1.3em"></div>`);
  const inp = s.c.querySelector('#kp-amt'), hint = s.c.querySelector('#kp-amt-s'); const show = () => { const n = numOf(inp.value); hint.textContent = n >= 1 ? '≈ $' + cn(n) : ''; }; inp.oninput = show; show();
  s.c.appendChild(kbtn('確認付款', () => { const n = numOf(inp.value); if (!(n >= 1)) return toast('請輸入金額', '#dc3545'); s.close(); kpPay(name, n); }, '#111', 'padding:13px;font-size:1.05rem;font-weight:bold'));
}
function kpScan() {
  let reader = null, done = false; const s = sheet('掃碼付款', () => { done = true; try { reader && reader.reset(); } catch {} });
  s.c.insertAdjacentHTML('beforeend', '<div style="background:#000;border-radius:14px;overflow:hidden;height:220px"><video id="kp-vid" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video></div><div id="kp-st" style="text-align:center;color:#666;font-size:.9rem">對準對方的 KUN Pay 收款碼</div>');
  const st = s.c.querySelector('#kp-st'), vid = s.c.querySelector('#kp-vid');
  const got = txt => { if (done) return; const r = parseCode(txt); if (!r) { st.textContent = '這不是 KUN Pay 收款碼'; return; } s.close(); kpPayDialog(r.name, r.amount); };
  if (typeof ZXing === 'undefined') st.textContent = '掃描元件載入失敗，請改用「貼上代碼」或上傳圖片';
  else { try { reader = new ZXing.BrowserMultiFormatReader(); Promise.resolve(reader.decodeFromVideoDevice(undefined, vid, r => { if (r) got(r.getText()); })).catch(() => { st.textContent = '無法開啟相機，請改用「貼上代碼」或上傳圖片'; }); } catch { st.textContent = '無法開啟相機，請改用「貼上代碼」或上傳圖片'; } }
  const fi = $('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
  fi.onchange = () => { const f = fi.files && fi.files[0]; if (!f) return; if (typeof ZXing === 'undefined') return toast('掃描元件未載入', '#dc3545'); new ZXing.BrowserMultiFormatReader().decodeFromImageUrl(URL.createObjectURL(f)).then(r => got(r.getText())).catch(() => toast('圖片中找不到有效的 QR Code', '#dc3545')); };
  const row = $('div', 'display:flex;gap:8px'); row.append(kbtn('上傳圖片', () => fi.click(), '#17a2b8', 'flex:1'), kbtn('貼上 / 輸入代碼', () => { const v = prompt('請貼上收款碼，或輸入對方玩家名稱：'); if (v) got(v); }, '#fd7e14', 'flex:1'), fi); s.c.appendChild(row);
}
function kpReceive() {
  const s = sheet('我的收款碼'); let text = '';
  s.c.insertAdjacentHTML('beforeend', `<div style="text-align:center;color:#666;font-size:.9rem">讓對方用 KUN Pay「掃碼付款」掃描。可指定收款金額。</div><input id="kp-ra" inputmode="numeric" placeholder="收款金額（留空＝讓對方自己輸入）" style="${IN}"><div id="kp-ras" style="text-align:center;color:#111;min-height:1.3em"></div><div id="kp-qr" style="display:flex;justify-content:center;padding:8px"></div><div style="text-align:center;font-weight:bold">${esc(acc.name)}</div>`);
  const inp = s.c.querySelector('#kp-ra'), box = s.c.querySelector('#kp-qr'), hint = s.c.querySelector('#kp-ras');
  const mk = () => { const n = numOf(inp.value), amt = n >= 1 ? n : 0; hint.textContent = amt ? '收款金額 $' + cn(amt) : ''; text = `KUNPAY1|${encodeURIComponent(acc.name)}|${amt ? ds(amt) : ''}`; box.innerHTML = ''; try { new QRCode(box, { text, width: 210, height: 210, correctLevel: QRCode.CorrectLevel.M }); } catch { box.textContent = text; } };
  let tm; inp.oninput = () => { clearTimeout(tm); tm = setTimeout(mk, 250); }; mk();
  s.c.appendChild(kbtn('複製收款代碼', () => { try { navigator.clipboard.writeText(text).then(() => toast('已複製收款代碼')).catch(() => prompt('請手動複製：', text)); } catch { prompt('請手動複製：', text); } }, '#17a2b8'));
}
async function kpTransfer() {
  await loadFriends(); const s = sheet('轉帳');
  s.c.insertAdjacentHTML('beforeend', `<div style="color:#666;font-size:.9rem">你的餘額：$${kb(state.balance)}　選擇好友，或輸入任何玩家名稱</div><div id="kp-fr" style="display:flex;gap:6px;flex-wrap:wrap"></div><input id="kp-tn" maxlength="16" placeholder="收款人玩家名稱" style="${IN}"><input id="kp-ta" inputmode="numeric" placeholder="金額" style="${IN}"><div id="kp-tas" style="text-align:center;color:#111;min-height:1.3em"></div>`);
  const tn = s.c.querySelector('#kp-tn'), ta = s.c.querySelector('#kp-ta'), hint = s.c.querySelector('#kp-tas');
  FD.friends.forEach(f => { const b = $('button', 'border:1px solid #cfe8d6;background:#eee;border-radius:16px;padding:6px 12px;font-size:.85rem;cursor:pointer', (f.fav ? '⭐ ' : '') + esc(f.nick || f.name)); b.onclick = () => { tn.value = f.name; }; s.c.querySelector('#kp-fr').appendChild(b); });
  ta.oninput = () => { const n = numOf(ta.value); hint.textContent = n >= 1 ? '≈ $' + cn(n) : ''; };
  s.c.appendChild(kbtn('確認轉帳', () => { const name = tn.value.trim(), n = numOf(ta.value); if (!name) return toast('請輸入收款人', '#dc3545'); if (!(n >= 1)) return toast('請輸入金額', '#dc3545'); if (!confirm(`確定轉 $${fm(n)} 給 ${name}？`)) return; s.close(); kpPay(name, n); }, '#111', 'padding:13px;font-size:1.05rem;font-weight:bold'));
}
async function kpBuy(k, to, toName) {
  const s = metaOf(k); if (!s || kpBusy) return; if (s.price > state.balance) return toast('現金不足，無法購買', '#dc3545');
  if (!confirm(`花費 $${fm(s.price)} 購買「${s.name}」${to ? `並送給 ${toName}` : ''}？`)) return;
  kpBusy = true; xferBusy = true;
  try { await save().catch(() => {}); const r = await api('/api/kunpay/buy', { body: { k, to } }); state.balance = Math.max(0, state.balance - r.price); rev = r.rev; refresh(); toast(to ? `🎁 已送出「${s.name}」給 ${toName}` : `🛒 已購買「${s.name}」`); save().catch(() => {}); await kpLoad(); }
  catch (e) { toast(e.message, '#dc3545'); } finally { kpBusy = false; xferBusy = false; }
}
function kpUse(k) { const s = metaOf(k), id = firstId(k); if (!s || !id) return; if (!confirm(`使用「${s.name}」？\n${s.desc}`)) return; api('/api/kunpay/use', { body: { cid: id } }).then(kpLoad).catch(e => { toast(e.message, '#dc3545'); kpLoad(); }); }
function kpGiveCoupon(k) {
  const s = metaOf(k), id = firstId(k); if (!s || !id) return;
  pickFriend(`把「${esc(s.name)}」送給誰？`, f => api('/api/kunpay/gift', { body: { cid: id, to: f.id } }).then(() => { toast(`🎁 已送給 ${f.nick || f.name}`); kpLoad(); }).catch(e => { toast(e.message, '#dc3545'); kpLoad(); }));
}
function kpGiftMenu() {
  if (!KP.coupons.length) { toast('你還沒有優惠券，先買一張，或直接「買來送朋友」', '#6c757d'); return kpGo('kp-shop'); }
  const s = sheet('選擇要送出的優惠券'), g = {}; KP.coupons.forEach(c => g[c.k] = (g[c.k] || 0) + 1);
  Object.entries(g).forEach(([k, n]) => { const m = metaOf(k); if (!m) return; const b = $('button', `display:flex;align-items:center;gap:10px;border:1px solid #e8e8e8;background:#fff;border-radius:12px;padding:10px;font-size:1rem;text-align:left;cursor:pointer`, `<span style="color:#111;display:flex">${ic(cpIc(k), 26)}</span><span style="flex:1">${esc(m.name)}</span><b>×${n}</b>`); b.onclick = () => { s.close(); kpGiveCoupon(k); }; s.c.appendChild(b); });
}
function kpAct(a, k) {
  const m = { scan: kpScan, recv: kpReceive, xfer: kpTransfer, friends: () => { document.getElementById('app').scrollLeft = window.innerWidth * 4; }, gift: kpGiftMenu, shop: () => kpGo('kp-shop'), mine: () => kpGo('kp-mine'), hist: () => kpGo('kp-hist'),
    buy: () => kpBuy(k), buyto: () => pickFriend('買來送給誰？', f => kpBuy(k, f.id, f.nick || f.name)), use: () => kpUse(k), giveto: () => kpGiveCoupon(k) };
  (m[a] || (() => {}))();
}
function kpInit() {
  const root = document.getElementById('panel-kunpay'); if (!root) return;
  root.onclick = e => { const b = e.target.closest && e.target.closest('[data-a]'); if (b) kpAct(b.dataset.a, b.dataset.k); };
  kpRender(); kpLoad(); setInterval(kpBal, 1000); setInterval(() => !dead && kpLoad(), 30000);
}

function menu() {
  const b = $('button', 'position:fixed;right:12px;bottom:40px;z-index:9001;width:44px;height:44px;border-radius:50%;border:none;background:#f39c12;color:#fff;font-size:1.3rem;box-shadow:0 3px 10px rgba(0,0,0,.3)', '🎁');
  b.className = 'mc-fab'; b.onclick = () => { const o = full(); o.style.background = 'rgba(255,255,255,.97)';
    o.innerHTML = `<h3>👤 ${acc.name}</h3><div style="font-size:.8rem;color:#666">登入金鑰（換裝置用，請勿外流）<br><b style="user-select:all">${acc.key}</b></div>
    <input id="cd" placeholder="輸入兌換碼" style="padding:10px;width:240px;border:1px solid #ccc;border-radius:8px"><button class="btn gold" id="rd">兌換</button>
    <button class="btn secondary" id="cp">${needPw ? '設定密碼' : '修改密碼'}</button><button class="btn danger" id="lo">登出</button><button class="btn secondary" id="cl">關閉</button>`;
    o.querySelector('#cl').onclick = () => o.remove();
    o.querySelector('#cp').onclick = () => { o.remove(); pwModal(); };
    o.querySelector('#rd').onclick = () => api('/api/redeem', { body: { code: o.querySelector('#cd').value } }).then(() => { toast('兌換成功'); o.remove(); }).catch(e => toast(e.message, '#dc3545'));
    o.querySelector('#lo').onclick = () => { save().finally(() => { clearAcc(); localStorage.removeItem('minimalCapitalSave'); location.reload(); }); };
    document.body.appendChild(o); };
  document.body.append(b, bar);
}
async function start() {
  try {
    const r = await api('/api/save'); rev = r.rev || 0; if (r.save) { applySavePackage(r.save); refresh(); } else await save();
    unboot(); connect(); menu(); friendsInit(); lbInit(); kpInit(); setInterval(() => !dead && save().catch(e => { if (e.data && e.data.stale) { if (!xferBusy && e.data.rev > rev) resync(); return; } if (/封鎖|未登入/.test(e.message)) blocked(e.message); else if (/異常/.test(e.message)) api('/api/save').then(r => { rev = r.rev || 0; if (r.save) { applySavePackage(r.save); refresh(); } toast('偵測到異常數據，已還原為伺服器進度', '#dc3545'); }).catch(() => {}); }), 5000);
    window.addEventListener('pagehide', () => navigator.sendBeacon && 0);
  } catch (e) { if (/封鎖/.test(e.message)) blocked(e.message); else if (e.status === 0 || e.status >= 500 || e.status === 429) { waitMsg((e.message || '伺服器連線中') + '，自動重試中…'); await sleep(3000); boot(); } else { acc = null; clearAcc(); loginScreen(e.message || '登入已失效，請重新登入'); } }
}
async function boot() {
  if (!acc) return loginScreen();
  try { const r = await api('/api/login', { body: { name: acc.name, key: acc.key, dev: DEV } }); needPw = !!r.needPw; storeAcc(acc); await start(); if (needPw) setTimeout(() => !dead && pwModal(), 1500); }
  catch (e) {
    if (/封鎖/.test(e.message)) return blocked(e.message);
    if (e.status === 0 || e.status >= 500 || e.status === 429) { waitMsg((e.status === 503 ? e.message : '伺服器啟動中或網路不穩，自動重試中…') ); await sleep(e.status === 503 ? 10000 : 3000); return boot(); }
    if (e.status === 410 && e.data && e.data.deleted) { acc = null; clearAcc(); wipeLocal(); return loginScreen('這個帳號已被管理員刪除，本機的舊進度也已清除。'); }
    acc = null; clearAcc(); loginScreen(e.status === 404 ? e.message : '登入已失效，請輸入名稱與密碼重新登入');
  }
}
boot();
})();
