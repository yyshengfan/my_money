// 右下角「浏览 / 点赞 / 收藏」小部件(hub/stock/crypto 三个公开页共用)。
// 收藏无法用 JS 弹原生书签框,点击提示 ⌘/Ctrl+D。node public/stats.js 自检。

// 纯函数:从 URL 取页面 key(与后端 clean() 同口径),自检用
const pageKey = p => {
  const s = String(p || '').toLowerCase().replace(/^.*\//, '').replace(/\.html$/, '');
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : 'hub';
};
const fmtN = n => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n));

if (typeof window !== 'undefined') {
  const page = pageKey(location.pathname);
  const box = document.createElement('div');
  box.id = 'statw';
  box.innerHTML = `<span class="sw" title="本页浏览量(每次打开计一次)">👁 <b id="sw-v">…</b></span>
    <button class="sw lk" id="sw-l" title="点赞">♥ <b id="sw-lv">…</b></button>
    <button class="sw bm" id="sw-b" title="收藏本页">🔖</button>`;
  document.body.appendChild(box);
  const V = box.querySelector('#sw-v'), L = box.querySelector('#sw-l'), LV = box.querySelector('#sw-lv');
  const post = (url, cb) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page }) })
      .then(r => r.json()).then(j => cb(j && j.data)).catch(() => {});
  const paint = d => { if (!d) return; V.textContent = fmtN(d.views); LV.textContent = fmtN(d.likes); };
  const liked = () => { try { return localStorage.getItem('liked:' + page) === '1'; } catch { return false; } };
  L.classList.toggle('on', liked());
  // 浏览:同一标签页每次会话只上报一次(sessionStorage);服务端逐次计入 MySQL stat_view(每 IP 一行)
  let seen = false;
  try { seen = sessionStorage.getItem('viewed:' + page) === '1'; } catch {}
  if (!seen) {
    try { sessionStorage.setItem('viewed:' + page, '1'); } catch {}
    post('/api/stats/view', paint);
  } else {
    fetch('/api/stats?page=' + page).then(r => r.json()).then(j => paint(j && j.data)).catch(() => {});
  }
  L.onclick = () => {
    if (liked()) return;
    post('/api/stats/like', d => {
      if (d) { paint(d); L.classList.add('on'); try { localStorage.setItem('liked:' + page, '1'); } catch {} }
    });
  };
  box.querySelector('.bm').onclick = e => {
    const t = document.createElement('div');
    t.id = 'sw-tip';
    t.textContent = '按 ' + (/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl') + '+D 收藏本页';
    document.body.appendChild(t);
    e.currentTarget.after(t);
    setTimeout(() => t.remove(), 2600);
  };
}

// ---- node 自检 ----
if (typeof window === 'undefined') {
  const assert = require('assert');
  assert.strictEqual(pageKey('/public/hub.html'), 'hub');
  assert.strictEqual(pageKey('/public/stock.html'), 'stock');
  assert.strictEqual(pageKey('/'), 'hub');
  assert.strictEqual(pageKey('../../etc/passwd'), 'passwd');
  assert.strictEqual(fmtN(88), '88');
  assert.strictEqual(fmtN(12345), '1.2万');
  console.log('stats.js selftest OK');
}
