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
  // 手动刷新加载动画(2026-09-21;2026-09-23 用户要求升级):点「刷新」→ 顶端扫描光带 + body.ref-loading
  // (theme.css 给每个 .panel/.gcard 盖「数据加载中」罩,整批回齐一起收——各页渲染本就是 Promise.all 一批)。
  // 触发点取 fetch 本身(两条刷新路都经过:__apibust 直连 / holdings 的 ?fresh=1),后台 SWR 重取不算、不闪(90%静止)。
  let scan, scanN = 0, scanT = 0;
  const scanOff = () => {
    if (scan) scan.hidden = true;
    try { document.body.classList.remove('ref-loading'); } catch (e) { /* ignore */ }
  };
  const armScan = hold => {
    if (!scan) { scan = document.createElement('div'); scan.id = 'loadscan'; document.body.appendChild(scan); }
    scan.hidden = false;
    try { document.body.classList.add('ref-loading'); } catch (e) { /* ignore */ }
    clearTimeout(scanT);
    scanT = setTimeout(scanOff, hold ? 70000 : 25000); // 兜底必灭:常规 2×(10s超时+重试);持仓慢路 2×30s 顶到 70s
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
    // 持仓板块不走缓存(2026-09-22 用户要求):/api/holding/* 从不读/写本地缓存,永远直连;
    // 服务端已是实时直连,响应可能慢于常规 10s(整户 okxLive/11 只日K),超时放宽到 30s;失败不回放旧值,让页面显示加载中。
    const hold = /^\/api\/holding\//.test(u);
    // 2026-09-23 用户要求「服务端也直连上游」:手动刷新给 URL 补 fresh=1,ReportMiddleware 见之开 3s
    // 窗口,net.cached() 实时层(ttl<5min)不再抬 5min、直接打上游。缓存键剥掉 fresh 标记,与平时同一份缓存。
    const ckey = u.replace(/([?&])fresh=1(?=&|$)/, '$1').replace(/[?&]$/, '');
    const tgt = manual && typeof input === 'string' ? ckey + (ckey.includes('?') ? '&' : '?') + 'fresh=1' : input;
    const c = !hold && /^\/api\//.test(ckey) && ckey.split('?')[0] !== '/api/me' && !pending[ckey] && !bust ? readCK(ckey) : null;
    if (c && c.b) {
      if (Date.now() - c.t > STALE_MS) { pending[ckey] = 1; revalidate(ckey, init); } // 先回 stale,后台换 new
      return mkRes(c.b, c.t);
    }
    if (manual) { scanN++; armScan(hold); }
    const attempt = () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), hold ? 30000 : 10000);
      const opt = Object.assign({}, init, { signal: ctl.signal });
      if (manual) opt.cache = 'no-store'; // 手动刷新连浏览器层缓存也不碰
      return realFetch(tgt, opt).finally(() => clearTimeout(timer));
    };
    try {
      let r;
      try { r = await attempt(); }
      catch (e) { if (!manual) throw e; r = await attempt(); } // 手动刷新超时/断流 → 自动重试一次(2026-09-23 用户要求)
      if (r.ok) {
        r.clone().text().then(s => {
          if (!hold && s && s[0] === '{') { try { localStorage.setItem(CK + ckey, JSON.stringify({ t: Date.now(), b: s })); } catch (e) { /* 配额满就放弃存 */ } }
        }).catch(() => {});
      }
      return r;
    } catch (e) {
      if (manual) throw e; // 手动刷新只用实时数据:重试仍挂也不回放旧缓存,页面按源诚实显 ✗
      const k = hold ? null : readCK(ckey);
      if (k && k.b) return mkRes(k.b, k.t); // 非手动超时/断流且存过 → 回放上次成功响应
      throw e;
    } finally {
      if (manual) tickScan();
    }
  };

  // 板块级局部刷新(2026-10-18 用户要求):页面主 JS 注册 window.panelRef[id]=async 函数(只重取本板块的源、只重渲本板块),
  // nav.js 统一给对应 .panel 右上角挂 ⟳。点 ⟳ 只罩板块本体(.ref-loading,样式在 theme.css);
  // 整页罩(body.ref-loading)+顶端扫描条(#loadscan)仍专属页头「刷新」按钮,两条路互不触发。
  window.panelFetch = function (u) {
    const t = u + (u.indexOf('?') >= 0 ? '&' : '?') + 'fresh=1';
    return realFetch(t, { cache: 'no-store' }).then(r => {
      // 与包装 fetch 同规矩写 SWR 缓存(持仓板块豁免缓存,这里也不存,免得大块 JSON 白占配额)
      if (r.ok && !/^\/api\/holding\//.test(u)) r.clone().text().then(s => {
        if (s && s[0] === '{') { try { localStorage.setItem(CK + u, JSON.stringify({ t: Date.now(), b: s })); } catch (e) { /* 配额满就放弃存 */ } }
      }).catch(() => {});
      return r.json().catch(() => null);
    }).catch(() => null); // 板块直连失败回 null,不读缓存不回放旧值(板块刷新=只看实时,页面按源显 ✗)
  };
  window.refreshPanel = function (id) {
    const el = document.getElementById(id); const fn = window.panelRef && window.panelRef[id];
    if (!el || !fn || el.classList.contains('ref-loading')) return; // 在途不重入
    el.classList.add('ref-loading');
    Promise.resolve().then(fn).catch(() => {}).then(() => el.classList.remove('ref-loading'));
  };
  let pbt = 0;
  function panelBtns() { // ⟳ 挂在板块根节点上;渲染只换内部 DOM,个别整块重建的场景由 MutationObserver 补漏
    Object.keys(window.panelRef || {}).forEach(id => {
      const p = document.getElementById(id);
      if (!p || p.querySelector('.pref')) return;
      p.setAttribute('data-pref', '');
      const b = document.createElement('button');
      b.className = 'pref'; b.title = '仅刷新本板块'; b.textContent = '⟳';
      b.addEventListener('click', ev => { ev.stopPropagation(); window.refreshPanel(id); });
      p.appendChild(b);
    });
  }
  try {
    if (document.body && window.MutationObserver) {
      new window.MutationObserver(() => { clearTimeout(pbt); pbt = setTimeout(panelBtns, 600); })
        .observe(document.body, { childList: true, subtree: true });
    }
  } catch (e) { /* ignore */ }
  panelBtns(); // 兜底插一次(panelRef 由页面主 JS 在其后注册,正常靠上面的 observer)

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
