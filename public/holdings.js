/* 持仓板块前端:报价表渲染(纯展示,解析与代码映射在后端 qt.service,单测 test/qt.test.ts) */

if (typeof window !== 'undefined') {
  function fmtQuoteTime(t) {
    const d = String(t || '').replace(/\D/g, '');
    return d.length >= 12 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}` : (t || '—');
  }
  const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const sign = x => (x > 0 ? '+' : '') + Number(x).toFixed(2);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function loadAndRender() {
    const st = document.getElementById('status');
    const res = await fetch('/api/holding/quotes').catch(() => null);
    if (!res) { st.textContent = '加载失败:接口不可达'; return; }
    if (res.status === 401) { location.href = 'login.html?back=holdings.html'; return; }
    const j = await res.json();
    const rows = j.data || [];
    document.getElementById('tbl').innerHTML =
      `<thead><tr><th>名称</th><th>现价</th><th>涨跌</th><th>涨跌幅</th><th>最高</th><th>最低</th><th>行情时间</th></tr></thead><tbody>` +
      rows.map(r => r.ok
        ? `<tr><td class="nm"><b>${esc(r.name)}</b><span class="cd">${r.code}</span><span class="mk">${esc(r.market)}</span></td>
            <td>${r.price.toFixed(2)}</td>
            <td class="${cls(r.chg)}">${sign(r.chg)}</td>
            <td class="${cls(r.chgPct)}">${sign(r.chgPct)}%</td>
            <td>${r.high.toFixed(2)}</td><td>${r.low.toFixed(2)}</td>
            <td class="na">${fmtQuoteTime(r.time)}</td></tr>`
        : `<tr><td class="nm"><b>${esc(r.name)}</b><span class="cd">${r.code}</span><span class="mk">${esc(r.market)}</span></td>
            <td class="err" colspan="6">✗ ${esc(r.error || '无数据')}</td></tr>`
      ).join('') + '</tbody>';
    const bad = rows.filter(r => !r.ok).length;
    st.textContent = `共 ${rows.length} 只 · ${bad ? bad + ' 只行情失败' : '行情全部正常'} · 服务端 60s 缓存 · 页面时间 ${new Date().toLocaleTimeString('zh-CN')}`;
  }
  document.getElementById('refresh').onclick = loadAndRender;
  loadAndRender(); // 同 stock.js:块内自调用
}
