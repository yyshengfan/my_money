/* 全站统一顶栏(nav.js):① 按当前文件名给 nav 链接标 .on;② 渲染 #who 登录态。
   各页 HTML 的 header 已内联同一骨架(brand + 六链接 + 右侧控件 + <div class="who" id="who">)。
   每个页面(含 login.html)在自己主 JS 之前引入 <script src="nav.js"></script>。 */
(function () {
  // 顶层纯函数(自检用):href 是否等于当前页文件名
  function navActive(href, page) { return href === page; }

  if (typeof window === 'undefined') { return; }

  // 数据分层(2026-09-20 v2,用户要求「刷新先用缓存数据,接口后台取最新自动替换」)= stale-while-revalidate:
  // ① GET /api/* 本地有缓存 → 立即返回缓存秒渲;缓存超过 5min 才另起后台真实请求(同 URL 去重),
  //    成功且响应体有变化 → 存新 + 防抖派发 window 'apifresh',页面监听后重跑 loadAndRender 自动替换(tickScan 只闪变化数字)。
  // ② /money/* 与 /api/me 不抢跑 stale(记账/登录态不能显示旧值),维持原行为:直连+10s 超时/断流才回退缓存。
  // 只包 GET /api|/money;POST 与静态资源原样放行。缓存带 x-apicache 时间戳,页面「更新时间」自然显旧。
  const realFetch = window.fetch.bind(window);
  const CK = 'apicache:', STALE_MS = 300000, pending = {};
  // 登录身份切换(真账号↔演示,2026-09-20)时清缓存用:缓存键只有 URL 不含身份,不换账号会串数据
  window.purgeApiCache = function () { try { Object.keys(localStorage).filter(k => k.indexOf(CK) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* 隐私模式禁存储就算了 */ } };
  const readCK = u => { try { return JSON.parse(localStorage.getItem(CK + u) || 'null'); } catch (e) { return null; } };
  const mkRes = (b, t) => new Response(b, { status: 200, headers: { 'content-type': 'application/json', 'x-apicache': String(t) } });
  let aft; const afresh = () => { clearTimeout(aft); aft = setTimeout(() => { try { window.dispatchEvent(new Event('apifresh')); } catch (e) { /* ignore */ } }, 400); };
  // 手动刷新加载动画(2026-09-21 用户要求):点「刷新」→ 顶端扫描光带(theme.css #loadscan),本次触发的真实网络请求全部回齐即收。
  // 触发点取 fetch 本身(两条刷新路都经过:__apibust 直连 / holdings 的 ?fresh=1),后台 SWR 重取不算、不闪(90%静止)。
  let scan, scanN = 0, scanT = 0;
  const scanOff = () => { if (scan) scan.hidden = true; };
  const armScan = () => {
    if (!scan) { scan = document.createElement('div'); scan.id = 'loadscan'; document.body.appendChild(scan); }
    scan.hidden = false;
    clearTimeout(scanT); scanT = setTimeout(scanOff, 12000); // 兜底:请求全挂也最多亮 12s
  };
  const tickScan = () => { // 递减:归零留 350ms 宽限,顺序发起/二传补丁的请求之间不闪断
    if (--scanN <= 0) { scanN = 0; clearTimeout(scanT); scanT = setTimeout(scanOff, 350); }
  };
  async function revalidate(u, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await realFetch(u, Object.assign({}, init, { signal: ctl.signal, cache: 'no-store' }));
      if (r.ok) {
        const s = await r.text();
        if (s && s[0] === '{') {
          const old = readCK(u);
          try { localStorage.setItem(CK + u, JSON.stringify({ t: Date.now(), b: s })); } catch (e) { /* 配额满就放弃存 */ }
          if (!old || old.b !== s) afresh(); // 内容没变不广播,防二次渲染自激循环
        }
      }
    } catch (e) { /* 后台失败:继续显示旧缓存,下次进页再试 */ }
    finally { clearTimeout(timer); delete pending[u]; }
  }
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' || !/^\/(api|money)\//.test(u)) return realFetch(input, init);
    // __apibust:页内「刷新」按钮置 Date.now(),3s 窗口内无视本地缓存直连(同页并发多 fetch 共享该窗口,不消费标志)
    const bust = window.__apibust && Date.now() - window.__apibust < 3000;
    const manual = bust || /[?&]fresh/.test(u); // 两条手动刷新路:__apibust 直连(stock/crypto/hub)、?fresh=(holdings)
    const c = /^\/api\//.test(u) && u.split('?')[0] !== '/api/me' && !pending[u] && !bust ? readCK(u) : null;
    if (c && c.b) {
      if (Date.now() - c.t > STALE_MS) { pending[u] = 1; revalidate(u, init); } // 先回 stale,后台换 new
      return mkRes(c.b, c.t);
    }
    if (manual) { scanN++; armScan(); }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await realFetch(input, Object.assign({}, init, { signal: ctl.signal }));
      if (r.ok) {
        r.clone().text().then(s => {
          if (s && s[0] === '{') { try { localStorage.setItem(CK + u, JSON.stringify({ t: Date.now(), b: s })); } catch (e) { /* 配额满就放弃存 */ } }
        }).catch(() => {});
      }
      return r;
    } catch (e) {
      const k = readCK(u);
      if (k && k.b) return mkRes(k.b, k.t); // 超时/断流且存过 → 回放上次成功响应
      throw e;
    } finally {
      clearTimeout(timer);
      if (manual) tickScan();
    }
  };

  const page = location.pathname.split('/').pop() || 'hub.html';
  document.querySelectorAll('nav a[href]').forEach(a => {
    if (navActive(a.getAttribute('href'), page)) {
      a.classList.add('on');
      a.setAttribute('aria-current', 'page');
    }
  });

  // #who 登录态(/api/me 不守卫,公开可用)。登录后显示 用户名+退出,未登录显示 登录 链接带回跳
  const who = document.getElementById('who');
  if (!who) { return; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  fetch('/api/me').then(r => r.json()).then(j => {
    const u = j && j.data ? j.data.user : null;
    if (u) {
      who.innerHTML = `<span>👤 ${esc(u.username)}</span><a class="navlink" href="#" id="logout">退出</a>`;
      const lo = who.querySelector('#logout');
      lo.onclick = async e => {
        e.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        purgeApiCache(); // 退出即清:否则换账号登录会先看到上一身份(真/演示)的缓存
        location.reload();
      };
    } else {
      who.innerHTML = `<a class="navlink" href="login.html?back=${encodeURIComponent(page)}">登录</a>`;
    }
  }).catch(() => { who.textContent = ''; });
})();
