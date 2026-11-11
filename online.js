// 伺服器連線層：登入、雲端存檔、活動倍率、公告、指令發放、兌換碼
(() => {
const $ = (t, css, h = '') => { const e = document.createElement(t); e.style.cssText = css || ''; e.innerHTML = h; return e; };
const unboot = () => { const b = document.getElementById('boot'); if (b) b.remove(); };
const DEV = localStorage.getItem('mc_dev') || (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('mc_dev', d); return d; })();
let rev = 0, xferBusy = false;
const K = 'mc_account';
const readCookie = () => { try { const m = /(?:^|;\s*)mc_acc=([^;]+)/.exec(document.cookie); return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch { return null; } };
const loadAcc = () => { try { const a = JSON.parse(localStorage.getItem(K) || 'null'); if (a && a.name && a.key) return a; } catch {} return readCookie(); };
const storeAcc = a => { try { localStorage.setItem(K, JSON.stringify(a)); localStorage.setItem('mc_lastname', a.name); } catch {} document.cookie = 'mc_acc=' + encodeURIComponent(JSON.stringify(a)) + ';max-age=31536000;path=/;SameSite=Lax'; try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} };
const clearAcc = () => { try { localStorage.removeItem(K); } catch {} document.cookie = 'mc_acc=;max-age=0;path=/'; };
let acc = loadAcc(), evs = [], off = 0, es, applied = new Set(), dead = false;
const api = (p, o = {}) => fetch(p, { method: o.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-token': acc ? acc.key : '' }, body: o.body && JSON.stringify(o.body) }).catch(() => { const er = new Error('無法連線到伺服器'); er.status = 0; er.data = {}; throw er; }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { const er = new Error(j.error || r.status); er.data = j; er.status = r.status; throw er; } return j; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitMsg = t => { let b = document.getElementById('boot'); if (!b) { b = $('div', 'position:fixed;inset:0;z-index:100000;background:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:1.1rem;color:#555;text-align:center;padding:20px'); b.id = 'boot'; document.body.appendChild(b); } b.textContent = t; };
const full = () => $('div', 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center');
const toast = (t, bg = '#28a745') => { const e = $('div', `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99998;background:${bg};color:#fff;padding:10px 16px;border-radius:10px;max-width:90vw;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:.95rem`, t); document.body.appendChild(e); setTimeout(() => e.remove(), 4500); };
const refresh = () => { try { renderBuffSlots(); renderCurrentCard(); renderCompanies(); renderStocks(); renderFriendList(); updateUI(); } catch (e) { console.error(e); } };

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
  else if (c.type === 'reset') { Object.assign(state, { balance: 0, rebirths: 0, capitalCores: 0, bankDeposit: 0, inventory: {}, equippedBuffs: [], multiplier: 1 }); companies.forEach((x, i) => { x.level = 0; x.cost = Math.floor(300 * Math.pow(1.5, i)); }); stocks.forEach(s => s.owned = 0); }
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
  es.addEventListener('dm', e => { const d = JSON.parse(e.data); if (chatWith && chatWith.id === d.from) loadChat(); else { toast(`💬 ${d.name}：${d.text.slice(0, 40)}`, '#0d6efd'); loadFriends(); } });
  es.addEventListener('kick', e => blocked(JSON.parse(e.data).reason));
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
function menu() {
  const b = $('button', 'position:fixed;right:12px;bottom:40px;z-index:9001;width:44px;height:44px;border-radius:50%;border:none;background:#f39c12;color:#fff;font-size:1.3rem;box-shadow:0 3px 10px rgba(0,0,0,.3)', '🎁');
  b.onclick = () => { const o = full(); o.style.background = 'rgba(255,255,255,.97)';
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
    unboot(); connect(); menu(); friendsInit(); setInterval(() => !dead && save().catch(e => { if (e.data && e.data.stale) { if (!xferBusy && e.data.rev > rev) resync(); return; } if (/封鎖|未登入/.test(e.message)) blocked(e.message); else if (/異常/.test(e.message)) api('/api/save').then(r => { rev = r.rev || 0; if (r.save) { applySavePackage(r.save); refresh(); } toast('偵測到異常數據，已還原為伺服器進度', '#dc3545'); }).catch(() => {}); }), 5000);
    window.addEventListener('pagehide', () => navigator.sendBeacon && 0);
  } catch (e) { if (/封鎖/.test(e.message)) blocked(e.message); else if (e.status === 0 || e.status >= 500 || e.status === 429) { waitMsg((e.message || '伺服器連線中') + '，自動重試中…'); await sleep(3000); boot(); } else { acc = null; clearAcc(); loginScreen(e.message || '登入已失效，請重新登入'); } }
}
async function boot() {
  if (!acc) return loginScreen();
  try { const r = await api('/api/login', { body: { name: acc.name, key: acc.key, dev: DEV } }); needPw = !!r.needPw; storeAcc(acc); await start(); if (needPw) setTimeout(() => !dead && pwModal(), 1500); }
  catch (e) {
    if (/封鎖/.test(e.message)) return blocked(e.message);
    if (e.status === 0 || e.status >= 500 || e.status === 429) { waitMsg((e.status === 503 ? e.message : '伺服器啟動中或網路不穩，自動重試中…') ); await sleep(e.status === 503 ? 10000 : 3000); return boot(); }
    acc = null; clearAcc(); loginScreen(e.status === 404 ? e.message : '登入已失效，請輸入名稱與密碼重新登入');
  }
}
boot();
})();
