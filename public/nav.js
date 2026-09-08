/* 全站统一顶栏(nav.js):① 按当前文件名给 nav 链接标 .on;② 渲染 #who 登录态。
   各页 HTML 的 header 已内联同一骨架(brand + 六链接 + 右侧控件 + <div class="who" id="who">)。
   每个页面在自己主 JS 之前引入 <script src="nav.js"></script>。login.html 是独立居中卡片,不引入。 */
(function () {
  // 顶层纯函数(自检用):href 是否等于当前页文件名
  function navActive(href, page) { return href === page; }

  if (typeof window === 'undefined') { return; }
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
      lo.onclick = async e => { e.preventDefault(); await fetch('/api/logout', { method: 'POST' }); location.reload(); };
    } else {
      who.innerHTML = `<a class="navlink" href="login.html?back=${encodeURIComponent(page)}">登录</a>`;
    }
  }).catch(() => { who.textContent = ''; });
})();
