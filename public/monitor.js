// 异动监控页逻辑(2026-10-18,2026-10-19 扩 A股板块):浏览器渲染 + `node public/monitor.js` 自检双模式(同 holdings.js)。
// rows 里 mkt==='a' 为 A股(六位代码,¥两格),否则币圈($,fmtPx 位数分档)。看板/配置/历史均按「币圈 | A股」两块分组(2026-10-19 用户要求)。
// 三块看板都吃同一个端点 GET /api/monitor/status;板块 ⟳ 用 nav.js panelFetch(直连实时,持仓式豁免——本页绝不走 SWR 秒回旧值)。

// —— 顶层纯函数(自检可直跑)——
const BJ = 8 * 3600e3;
function bjTs(ts) { return ts ? new Date(ts + BJ).toISOString().slice(5, 16).replace('T', ' ') : '—'; } // MM-DD HH:mm 北京
function spPct(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; } // 只补 +,负号自带(hub 教训)
function fmtPx(p, a) { return p == null || !isFinite(p) ? '—' : a ? '¥' + p.toFixed(2) : '$' + (p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toFixed(4)); }
const nmOf = r => (r.mkt === 'a' ? escJs(r.name || r.sym) + ' ' + r.sym : r.sym); // 表内标的名:A股中文名+代码,币圈代码
const escJs = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// —— 2026-10-19 UI 优化:裸数字 → 仪表盘(进度条让「离触发线多远」一眼可辨)——
// 双向规:中线=0,左右半宽=阈值 ±thr,填充 ∝|v|/thr(封顶),绿涨红跌、越限琥珀(与 pill.fire 同色)、规则停用整条压暗
function gauge(v, thr, fire, off) {
  const txt = v == null || !isFinite(v) ? '<span class="na">—</span>'
    : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : 'na'}">${spPct(v)}</span>`;
  const dim = off ? ' class="off"' : '';
  if (!thr || v == null || !isFinite(v)) return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz dim"><i class="mid"></i></div></div></td>`;
  const p = +(Math.min(Math.abs(v) / thr, 1) * 50).toFixed(1);
  const cls = fire ? 'ff' : v > 0 ? 'up' : v < 0 ? 'dn' : 'zz';
  return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz" title="${spPct(v)} / 阈值 ±${thr}%${fire ? ' · 越限' : ''}"><i class="mid"></i><b class="${cls}${v < 0 ? ' lf' : ''}" style="left:${v >= 0 ? 50 : +(50 - p).toFixed(1)}%;width:${p}%"></b></div></div></td>`; // lf=左半填充,动画伸展开贴中线
}
// 单向规(振幅只论大小不分方向):左端 0 → 阈值,蓝=未越限、琥珀=越限
function ampG(v, thr, fire, off) {
  const txt = v == null || !isFinite(v) ? '<span class="na">—</span>' : `<span class="v0">${spPct(v).replace('+', '')}</span>`;
  const dim = off ? ' class="off"' : '';
  if (!thr || v == null || !isFinite(v)) return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz dim"><i class="mid r"></i></div></div></td>`;
  const p = +(Math.min(v / thr, 1) * 100).toFixed(1);
  return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz" title="${v.toFixed(2)}% / 阈值 ${thr}%${fire ? ' · 越限' : ''}"><b class="${fire ? 'ff' : 'ac'}" style="left:0;width:${p}%"></b></div></div></td>`;
}
// 日内位置:现价点落在 [日低,日高] 何处,▏=今开;点在右=贴日高、左=贴日低(绿=现价≥今开)
function rangeCell(price, day, isA, fire) {
  const na = '<td><div class="gzc"><span class="vline"><span class="na">—</span></span><div class="rg dim"></div></div></td>';
  if (price == null || !day || !(day.hi > day.lo)) return na;
  const f = (x) => +Math.min(Math.max((x - day.lo) / (day.hi - day.lo) * 100, 0), 100).toFixed(1);
  const pos = f(price), op = f(day.open);
  const px = (x) => fmtPx(x, isA);
  return `<td><div class="gzc"><small class="rl">${px(day.lo)} → ${px(day.hi)}</small><div class="rg" title="日低 ${px(day.lo)} · 今开 ${px(day.open)} · 日高 ${px(day.hi)}"><i class="tick" style="left:${op}%"></i><b class="${fire ? 'ff' : price >= day.open ? 'up' : 'dn'}" style="left:${pos}%"></b></div></div></td>`;
}
// 单向规(量比,倍数不分方向):左端 0 → 阈值,蓝=未越限、琥珀=越限;与 ampG 同壳,只是单位换成 ×
function volG(v, thr, fire, off) {
  const txt = v == null || !isFinite(v) ? '<span class="na">—</span>' : `<span class="v0">${v.toFixed(2)}×</span>`;
  const dim = off ? ' class="off"' : '';
  if (!thr || v == null || !isFinite(v)) return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz dim"><i class="mid r"></i></div></div></td>`;
  const p = +(Math.min(v / thr, 1) * 100).toFixed(1);
  return `<td${dim}><div class="gzc"><span class="vline">${txt}</span><div class="gz" title="量比 ${v.toFixed(2)}× / 阈值 ${thr}×${fire ? ' · 越限' : ''}"><b class="${fire ? 'ff' : 'ac'}" style="left:0;width:${p}%"></b></div></div></td>`;
}
// ETF 暴量面板(2026-10-29):看板 + 全局一套阈值(清单在 data/etf_watch.json,不逐只配)
function etfTable(E) {
  const c = E.cfg;
  return `<div class="gcap"><b>上证宽基</b><small>${E.rows.map(r => escJs(r.name)).join(' · ')}</small><span class="whl">推送→「A股大舞台」</span></div>` +
    `<div class="tscroll"><table><thead><tr><th>标的 · 状态</th><th>现价</th><th class="gl">今日涨跌</th><th class="gl">今日成交额</th><th class="gl">量比<br><small>vs 前5日同段</small></th></tr></thead><tbody>` +
    E.rows.map(r => {
      const fire = c.on && r.st === 'fire';
      const pill = !c.on ? '<span class="pill off">⏸ 停用</span>'
        : fire ? `<span class="pill fire" title="自 ${bjTs(r.since)}">▲ 暴量</span>` : '<span class="pill ok">● 正常</span>';
      const chg = r.chgPct == null ? '<span class="na">—</span>'
        : `<span class="${r.chgPct > 0 ? 'pos' : r.chgPct < 0 ? 'neg' : 'na'}">${spPct(r.chgPct)}</span>`;
      return `<tr${fire ? ' class="fire"' : ''}><td class="nm">${escJs(r.name)} ${escJs(r.sym)}<br>${pill}</td>` +
        `<td class="num">${fmtPx(r.price, true)}</td><td class="num">${chg}</td>` +
        `<td class="num">${r.amtYi == null ? '<span class="na">—</span>' : r.amtYi.toFixed(1) + '亿'}</td>` +
        volG(r.ratio, c.ratio, fire, !c.on) + '</tr>';
    }).join('') + `</tbody></table></div>` +
    `<div class="sub">检测参数 · 保存 ≤60s 生效 · 清单 <code>data/etf_watch.json</code>(增删免重启)</div>` +
    `<div class="tscroll"><table><thead><tr><th>总开关</th><th>量比阈值 ×</th><th>成交额门槛(亿)</th></tr></thead><tbody><tr>` +
    `<td><label class="cbx"><input data-k="etf.on" type="checkbox" ${c.on ? 'checked' : ''}>监控</label></td>` +
    `<td><input data-k="etf.ratio" type="number" min="1" max="50" step="0.1" value="${c.ratio}" title="量比 ≥ 该倍数才算暴量"></td>` +
    `<td><input data-k="etf.minAmt" type="number" min="0" max="2000" step="1" value="${c.minAmt}" title="今日成交额低于该值不报(防「量比高但没几个钱」)"></td>` +
    `</tr></tbody></table></div>` +
    `<div class="gline"><button class="go gsave" type="button">保存配置</button></div>`;
}
// 总状态药丸:一行一枚,点名哪条规越限(旧版三列「状态」并入)
function overallPill(r) {
  // 裸 pill(二改版并入标的列,不再自包 td)
  if (!r.on) return '<span class="pill off">⏸ 停用</span>';
  const F = [['quick', '窗口'], ['dayChg', '日内'], ['dayAmp', '振幅']].filter(([k]) => r[k + 'S'].st === 'fire');
  if (!F.length) return '<span class="pill ok">● 正常</span>';
  return `<span class="pill fire" title="自 ${bjTs(F.map(([k]) => r[k + 'S'].since).filter(Boolean).sort()[0] || 0)}">▲ ${F.map((x) => x[1]).join('+')}越限</span>`;
}
// 全量保存体(看板开关即时保存 & 表单保存共用):以 status 回包为准,overrides 定点覆盖
function buildSave(S, pausedOver, taskOver) {
  const tasks = {};
  for (const r of S.rows) {
    tasks[r.sym] = { on: r.on, winMin: r.winMin, quickPct: r.quickPct, chgOn: r.chgOn, chgPct: r.chgPct, ampOn: r.ampOn, ampPct: r.ampPct, ...(taskOver?.[r.sym] || {}) };
  }
  return { paused: pausedOver == null ? S.cfg.paused : pausedOver, recovery: S.cfg.recovery, tasks };
}
// 表单一行(一币):开关+三规则勾选+四个数字
function cfgRow(r) {
  const num = (k, v, lo, hi, step, t) => `<input data-k="${r.sym}.${k}" type="number" min="${lo}" max="${hi}" step="${step}" value="${v}" title="${t}">`;
  const cb = (k, v, t) => `<label class="cbx"><input data-k="${r.sym}.${k}" type="checkbox" ${v ? 'checked' : ''}>${t}</label>`;
  return `<tr><td class="nm">${nmOf(r)}</td>` +
    `<td>${cb('on', r.on, '监控')}</td>` +
    `<td>${num('winMin', r.winMin, 1, 240, 1, '快速规则窗口(分钟)')} ${cb('qOn', true, '')}</td>` +
    `<td>${num('quickPct', r.quickPct, 0.1, 50, 0.1, '窗口内涨跌阈值 %')}</td>` +
    `<td>${cb('chgOn', r.chgOn, '涨跌')} ${num('chgPct', r.chgPct, 0.1, 50, 0.1, '日内涨跌阈值 %(现价 vs 今开)')}</td>` +
    `<td>${cb('ampOn', r.ampOn, '振幅')} ${num('ampPct', r.ampPct, 0.1, 50, 0.1, '日内振幅阈值 %(日高−日低)/今开')}</td></tr>`;
}
// 推送历史一行(全市场共用,分组见 HF 筛选)
function alertTr(a, nm) { // nm: {sym→展示名},测试行 sym='—' 不在表里落原文
  const rule = a.rule === 'test' ? '测试' : ({ quick: '窗口', dayChg: '日内涨跌', dayAmp: '日内振幅', vol: 'ETF暴量' }[a.rule] || a.rule);
  return `<tr><td class="num">${bjTs(a.ts)}</td><td><span class="ev ${a.rule === 'test' ? 't' : a.kind === 'recover' ? 'r' : 'f'}">${a.kind === 'recover' ? '○ 回落' : a.rule === 'test' ? '• 测试' : '▲ 触发'}</span></td><td>${escJs((nm || {})[a.sym] || a.sym)}</td><td>${rule}</td><td class="txt">${escJs(a.text)}</td>` +
    `<td class="${a.sendOk ? 'pos' : 'neg'}" title="${escJs(a.err)}">${a.sendOk ? '✓ 已送达' : '✗ ' + escJs(a.err || '失败')}</td></tr>`;
}
// 分组(2026-10-19 用户要求两块分开放):币圈在前、A股在后;webhook 状态挂各块小节头
const alertMkt = a => a.mkt || (/^\d{6}$/.test(String(a.sym)) ? 'a' : 'c');
function whChip(w, file) {
  return w.configured
    ? `<span class="pos">✓ …${escJs(w.tail)}${w.signed ? ' ·加签' : ''}</span>`
    : `<span class="neg" title="${file}">✗ 未配置</span>`;
}
function groups(S) {
  return [
    { cap: '币圈', grp: '币圈小剧场', file: 'echo 地址 &gt; ~/.lark_webhook && chmod 600(或 ~/.lark_webhook 的「## 币圈小剧场」段)', wh: S.webhooks.crypto, rows: S.rows.filter(r => r.mkt !== 'a') },
    { cap: 'A股', grp: 'A股大舞台', file: '在 ~/.lark_webhook 的「## A股大舞台」段下加一行地址(chmod 600;或写独立 ~/.lark_webhook_astock)', wh: S.webhooks.astock, rows: S.rows.filter(r => r.mkt === 'a') },
  ];
}
function liveTable(rows) {
  // 二改列数收紧:删「最后推送」(历史面板有)与「开关」(参数表总开关同一面板就在下方,即时/保存二选一已足够)
  // 状态 pill 并入标的列第二行——双栏窄,首列信息永不滚丢
  return `<div class="tscroll"><table><thead><tr><th>标的 · 状态</th><th>现价</th><th class="gl">日内位置<br><small>日低→日高 · ▏今开</small></th><th class="gl">窗口Δ<br><small>近N分钟 · 双向阈值</small></th><th class="gl">日内Δ<br><small>vs 今开 · 双向阈值</small></th><th class="gl">振幅<br><small>(高−低)/开</small></th></tr></thead><tbody>${
    rows.map(r => {
      const q = r.quickS.st === 'fire', c = r.chgOn && r.dayChgS.st === 'fire', m = r.ampOn && r.dayAmpS.st === 'fire';
      const ff = r.on && (q || c || m);
      return `<tr${ff ? ' class="fire"' : ''}><td class="nm">${nmOf(r)}<br>${overallPill(r)}</td><td class="num">${fmtPx(r.price, r.mkt === 'a')}</td>` +
        rangeCell(r.price, r.day, r.mkt === 'a', m || c) +
        gauge(r.quick, r.quickPct, q && r.on, !r.on) +
        gauge(r.day?.chg ?? null, r.chgPct, c, !r.on || !r.chgOn) +
        ampG(r.day?.amp ?? null, r.ampPct, m, !r.on || !r.ampOn) +
        `</tr>`;
    }).join('')
    }</tbody></table></div>`;
}
function gcap(g) {
  return `<div class="gcap"><b>${g.cap}</b><small>${g.rows.map(nmOf).join(' · ')}</small><span class="whl">推送→「${g.grp}」 ${whChip(g.wh, g.file)}</span></div>`;
}
// 配置表一行组(与 liveTable 对应,表头「标的」两板块通用)
function cfgTable(rows) {
  return `<div class="tscroll"><table><thead><tr><th>标的</th><th>总开关</th><th>窗口(分钟)</th><th>快阈值 %</th><th>日内涨跌</th><th>日内振幅</th></tr></thead><tbody>${rows.map(cfgRow).join('')}</tbody></table></div>`;
}
// 顶部状态条:运行/暂停、心跳、今日触发、越限中(webhook 状态已移到各分组小节头 gcap)
function statStrip(S) {
  const run = S.running;
  const state = run.paused ? '<span class="pill off">⏸ 已全局暂停</span>' : '<b class="hb" title="采样循环存活,每 60s 一跳"></b><span class="pill ok">● 运行中</span>'; // 心跳呼吸点=全页常驻动画(暂停/越限停则静止)
  return `${state} <span class="kv">采样心跳 ${bjTs(run.lastRunTs)}${run.loopOff ? ' · <b class="neg">循环已关(MONITOR_OFF)</b>' : ''}</span>` +
    ` <span class="kv">今日触发 <b>${S.todayFire}</b></span> <span class="kv">越限中 <b class="${S.firing ? 'neg' : ''}">${S.firing}</b></span>`;
}

// 定时任务一行(2026-10-19 用户要求把 somejob 里的任务也放到页面好配置):
// 计划时间=原生 time 输入;状态=launchd 已注册;最近运行=任务 stdout 日志 mtime(读取失败显 ✗)
// 相对时间(2026-10-19 UI 优化:最近运行只写时刻看不出新旧,"3小时前"一眼可辨)
function ago(ts, now) {
  const s = Math.max(0, (now - ts) / 1000);
  if (!(s >= 0)) return '';
  if (s < 90) return '刚刚';
  if (s < 86400) return Math.round(s / 3600) + '小时前';
  if (s < 86400 * 30) return Math.round(s / 86400) + '天前';
  return '';
}
function jobRow(j, now) {
  const st = j.err
    ? `<span class="neg" title="${escJs(j.err)}">✗ 读取失败</span>`
    : j.loaded
      ? '<span class="pill ok">● 已加载</span>'
      : '<span class="pill off">⏸ 未加载</span>';
  const lb = escJs(j.label);
  return `<tr><td class="nm jn">${escJs(j.title)}<small>${escJs(j.desc)} · ${lb}</small></td>` +
    `<td><input type="time" data-at="${lb}" value="${j.at || ''}"></td>` +
    `<td>${st}</td><td>${j.lastRun ? bjTs(j.lastRun) + '<small class="rl">' + (ago(j.lastRun, now || Date.now()) || '较早') + '</small>' : '—'}</td>` +
    `<td><button class="go" data-save="${lb}">保存</button> <button class="go" data-run="${lb}">立即运行</button> ` +
    `<button class="go" data-tg="${lb}" data-on="${j.loaded ? 0 : 1}">${j.loaded ? '停用' : '启用'}</button></td></tr>`;
}
function jobsTable(J, now) {
  if (!J || !J.length) return '<div class="na" style="padding:16px 18px">暂无任务(确认 ~/claude/somejob/jobs.json 与 plists/ 已就位)</div>';
  return `<div class="tscroll"><table><thead><tr><th>任务</th><th>计划时间</th><th>状态</th><th>最近运行</th><th>操作</th></tr></thead><tbody>${J.map(j => jobRow(j, now)).join('')}</tbody></table></div>`;
}

// —— 浏览器侧 ——
if (typeof window !== 'undefined') {
  let S = null;
  let J = null; // 定时任务行(GET /api/jobs/list)
  let HF = 'all'; // 推送历史市场筛选 'all'|'c'|'a'
  const el = id => document.getElementById(id);
  async function post(u, body) {
    const res = await window.fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .catch(() => null);
    if (!res) return { success: false, message: '网络失败' };
    if (res.status === 401) { location.href = 'login.html?back=monitor.html'; return { success: false, message: '未登录' }; }
    return res.json().catch(() => ({ success: false, message: '回包异常' }));
  }
  // status 只走 panelFetch(实时直连,绝不 SWR 秒回旧值——监控看板显示过期读数比报错更有害)
  async function load() {
    const j = await window.panelFetch('/api/monitor/status');
    if (!j) return false;
    if (j.success === false && /未登录/.test(j.message || '')) { location.href = 'login.html?back=monitor.html'; return false; }
    S = j.data;
    return true;
  }
  const jmsg = t => { el('jobsmsg').textContent = t; };
  async function loadJobs() {
    const r = await window.panelFetch('/api/jobs/list');
    if (!r) { J = null; jmsg('定时任务接口不可达'); return; }
    if (r.success === false && /未登录/.test(r.message || '')) { location.href = 'login.html?back=monitor.html'; return; }
    J = r.success ? r.data : null;
    jmsg(r.success ? '' : '定时任务读取失败:' + r.message);
  }
  // 2026-10-19 二改(用户「按类型集中放」):每市场一块面板=看板表+检测参数表,币圈|A股并排;全局态独立 m-glob
  function renderMarkets() {
    if (!S) return;
    const gs = groups(S);
    el('pcry').innerHTML = gcap(gs[0]) + liveTable(gs[0].rows) + `<div class="sub">检测参数 · 保存 ≤60s 生效</div>` + cfgTable(gs[0].rows) + `<div class="gline"><button class="go gsave" type="button">保存配置</button></div>`;
    el('past').innerHTML = gcap(gs[1]) + liveTable(gs[1].rows) + `<div class="sub">检测参数 · 保存 ≤60s 生效</div>` + cfgTable(gs[1].rows) + `<div class="gline"><button class="go gsave" type="button">保存配置</button></div>`;
    document.querySelectorAll('.gsave').forEach(b => b.onclick = () => saveCfg(b));
  }
  function renderEtf() {
    if (!S || !S.etf) return;
    el('petf').innerHTML = etfTable(S.etf);
    document.querySelectorAll('#petf .gsave').forEach(b => b.onclick = () => saveCfg(b));
  }
  // 保存钮在三块面板各一枚,但收集跨整个 document——另一块未保存的改动不丢
  async function saveCfg(btn) {
    const tasks = {}, over = {}, etf = {};
    for (const r of S.rows) over[r.sym] = {};
    document.querySelectorAll('input[data-k]').forEach(i => {
      const [sym, k] = i.dataset.k.split('.');
      const v = i.type === 'checkbox' ? i.checked : Number(i.value);
      if (sym === 'etf') { etf[k] = v; return; } // ETF 阈值是全局一套,不进 tasks
      over[sym][k] = v;
    });
    if ('ratio' in etf && !(etf.ratio >= 1 && etf.ratio <= 50)) { el('msg').textContent = 'ETF 量比阈值需 1~50'; return; }
    if ('minAmt' in etf && !(etf.minAmt >= 0 && etf.minAmt <= 2000)) { el('msg').textContent = 'ETF 成交额门槛需 0~2000 亿'; return; }
    for (const s of Object.keys(over)) { // 快阈值规则没有单独开关(窗口内涨跌即快规则),qOn 占位剔除
      const t = over[s]; if ('qOn' in t) delete t.qOn;
      tasks[s] = { on: !!t.on, winMin: t.winMin, quickPct: t.quickPct, chgOn: !!t.chgOn, chgPct: t.chgPct, ampOn: !!t.ampOn, ampPct: t.ampPct };
      if (!isFinite(tasks[s].winMin) || tasks[s].winMin < 1 || tasks[s].winMin > 240) { el('msg').textContent = `${s} 窗口需 1~240 分钟`; return; }
      for (const kk of ['quickPct', 'chgPct', 'ampPct']) if (!(tasks[s][kk] >= 0.1 && tasks[s][kk] <= 50)) { el('msg').textContent = `${s} ${kk} 需 0.1~50`; return; }
    }
    const body = { paused: el('g-pause').checked, recovery: el('g-rec').checked, tasks };
    if ('ratio' in etf) body.etf = { on: !!etf.on, ratio: etf.ratio, minAmt: etf.minAmt }; // 没渲染过 ETF 面板就不带(服务端保留盘上值)
    const r = await post('/api/monitor/save', body);
    if (r.success) { btn.textContent = '✓ 已保存'; load().then(ok => ok && renderAll()); }
    else el('msg').textContent = '保存失败:' + r.message;
  }
  function renderGlob() {
    if (!S) return;
    el('strip').innerHTML = statStrip(S);
    el('glob').innerHTML = `<label class="cbx"><input id="g-rec" type="checkbox" ${S.cfg.recovery ? 'checked' : ''}>越限回落后再推「恢复」通知</label>` +
      `<label class="cbx"><input id="g-pause" type="checkbox" ${S.cfg.paused ? 'checked' : ''}>全局暂停检测(看板照常刷新)</label>`;
  }
  function renderHist() {
    if (!S) return;
    const NM = {}; S.rows.forEach(r => { NM[r.sym] = r.mkt === 'a' ? (r.name || r.sym) + ' ' + r.sym : r.sym; });
    const list = S.alerts.filter(a => HF === 'all' || alertMkt(a) === HF);
    const cnt = v => v === 'all' ? S.alerts.length : S.alerts.filter(a => alertMkt(a) === v).length;
    el('hist').innerHTML =
      `<div class="frow">${[['all', '全部'], ['c', '币圈'], ['a', 'A股']].map(([v, t]) =>
        `<button type="button" class="fpill${HF === v ? ' on' : ''}" data-hf="${v}">${t} ${cnt(v)}</button>`).join('')}</div>` +
      (list.length
        ? `<div class="tscroll"><table><thead><tr><th>时间</th><th>事件</th><th>标的</th><th>规则</th><th>内容</th><th>投递</th></tr></thead><tbody>${list.map(a => alertTr(a, NM)).join('')}</tbody></table></div>`
        : `<div class="na" style="padding:16px 18px">${S.alerts.length ? '该板块暂无推送记录' : '暂无推送记录(触发或测试后出现在这里)'}</div>`);
    el('hist').querySelectorAll('button[data-hf]').forEach(b => b.onclick = () => { HF = b.dataset.hf; renderHist(); });
  }
  function renderJobs() {
    el('jobs').innerHTML = jobsTable(J);
    const act = async (u, body) => {
      const r = await post(u, body);
      await loadJobs();
      renderJobs();
      jmsg(r.success ? r.message : '✗ ' + r.message);
    };
    el('jobs').querySelectorAll('button[data-save]').forEach(b => b.onclick = () => {
      const inp = el('jobs').querySelector('input[data-at="' + b.dataset.save + '"]');
      act('/api/jobs/save', { label: b.dataset.save, at: inp ? inp.value : '' });
    });
    el('jobs').querySelectorAll('button[data-run]').forEach(b => b.onclick = () => act('/api/jobs/run', { label: b.dataset.run }));
    el('jobs').querySelectorAll('button[data-tg]').forEach(b => b.onclick = () => act('/api/jobs/toggle', { label: b.dataset.tg, on: b.dataset.on === '1' }));
  }
  function renderAll() { renderMarkets(); renderEtf(); renderGlob(); renderHist(); renderJobs(); }
  ['testbtn', 'testbtn-a'].forEach(id => {
    el(id).onclick = async () => {
      const mkt = id === 'testbtn-a' ? 'astock' : 'crypto';
      el('msg').textContent = '发送中…';
      const r = await post('/api/monitor/test', { mkt });
      el('msg').textContent = r.success ? '✓ ' + r.message : '✗ ' + r.message;
      load().then(ok => ok && renderHist());
    };
  });
  // 板块 ⟳(nav.js 自动挂):status 一端点喂三块,市场面板刷新连带全局条一起重渲(同刻数据一致)
  const refMkt = async () => { if (await load()) { renderMarkets(); renderEtf(); renderGlob(); } };
  window.panelRef = {
    'm-cry': refMkt,
    'm-ast': refMkt,
    'm-etf': async () => { if (await load()) { renderEtf(); renderGlob(); } },
    'm-glob': async () => { if (await load()) renderGlob(); },
    'm-history': async () => { if (await load()) renderHist(); },
    'm-jobs': async () => { await loadJobs(); renderJobs(); },
  };
  // 整页刷新:页头「刷新」= 全页罩(手动 body.ref-loading,panelFetch 不碰 nav 扫描机制)
  el('refresh').onclick = () => {
    document.body.classList.add('ref-loading');
    Promise.resolve(Promise.all([load(), loadJobs()])).then(() => S && renderAll()).finally(() => document.body.classList.remove('ref-loading'));
  };
  (async () => { await Promise.all([load(), loadJobs()]); if (S) renderAll(); else el('status').textContent = '监控接口不可达,点右上刷新重试'; })();
}

// —— node 自检 ——
if (typeof window === 'undefined') {
  const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
  assert(bjTs(Date.UTC(2026, 9, 18, 3, 22)) === '10-18 11:22', '北京时间');
  assert(spPct(3.2) === '+3.20%' && spPct(-3.2) === '-3.20%' && spPct(null) === '—', 'spPct 只补+不带双负');
  assert(fmtPx(64321.4) === '$64321' && fmtPx(0.12345) === '$0.1235', 'fmtPx 位数');
  assert(fmtPx(4.3456, true) === '¥4.35' && fmtPx(null, true) === '—', 'fmtPx A股 ¥ 两位');
  assert(nmOf({ mkt: 'a', sym: '600219', name: '南山铝业' }) === '南山铝业 600219' && nmOf({ mkt: 'c', sym: 'BTC' }) === 'BTC', 'nmOf 两板块名');
  assert(gauge(-3.21, 3, true).includes('ff lf') && gauge(-3.21, 3, true).includes('left:0%;width:50%'), 'gauge 负向越限=半宽封顶琥珀+lf 展开贴中线');
  assert(!gauge(1.5, 3).includes('lf'), 'gauge 正向无 lf');
  assert(gauge(1.5, 3).includes('up') && gauge(1.5, 3).includes('left:50%;width:25%'), 'gauge 正向填右半 1/4');
  assert(gauge(null, 3).includes('—') && gauge(1, 0).includes('gz dim'), 'gauge 无读数显 —、无阈值读数压暗');
  assert(gauge(1, 3, false, true).includes('class="off"'), 'gauge 规则停用整格压暗');
  assert(ampG(4.2, 5).includes('ac') && ampG(4.2, 5).includes('width:84%') && ampG(6, 5, true).includes('ff'), 'ampG 单向 84% 填充、越限琥珀');
  const rc = rangeCell(4.6, { open: 4.4, hi: 4.8, lo: 4 }, true, false);
  assert(rc.includes('left:75%') && rc.includes('class="tick" style="left:50%"') && rc.includes('¥4.00 → ¥4.80'), 'rangeCell 位置点/今开刻度/低高文');
  assert(rangeCell(4.6, { open: 4.4, hi: 4.8, lo: 4 }, true, true).includes('b class="ff"'), 'rangeCell 越限点变琥珀');
  assert(rangeCell(null, null).includes('—') && rangeCell(5, { open: 5, hi: 5, lo: 5 }, false).includes('—'), 'rangeCell 无读数/高低相等显 —');
  assert(overallPill({ on: false }).includes('⏸ 停用'), 'overallPill 停用');
  assert(overallPill({ on: true, quickS: { st: 'ok' }, dayChgS: { st: 'fire', since: 1 }, dayAmpS: { st: 'ok' } }).includes('▲ 日内越限'), 'overallPill 点名规则');
  assert(overallPill({ on: true, quickS: { st: 'ok' }, dayChgS: { st: 'ok' }, dayAmpS: { st: 'ok' } }).includes('● 正常'), 'overallPill 正常');
  assert(ago(Date.UTC(2026, 9, 18, 14, 59), Date.UTC(2026, 9, 18, 15, 0)) === '刚刚' && ago(Date.UTC(2026, 9, 18, 13, 0), Date.UTC(2026, 9, 18, 15, 0)) === '2小时前' && ago(Date.UTC(2026, 9, 15, 13, 0), Date.UTC(2026, 9, 18, 13, 0)) === '3天前' && ago(Date.UTC(2026, 8, 1, 0, 0), Date.UTC(2026, 9, 18, 13, 0)) === '', 'ago 相对时间档与超月不写');
  const WH = { crypto: { configured: true, tail: 'abcd1234', signed: true }, astock: { configured: false, tail: '', signed: false } };
  const st3 = { quickS: { st: 'ok', since: 0 }, dayChgS: { st: 'ok', since: 0 }, dayAmpS: { st: 'ok', since: 0 } };
  const fakeS = { cfg: { paused: false, recovery: true }, rows: [{ sym: 'BTC', mkt: 'c', price: 64321, quick: null, ...st3, on: true, winMin: 5, quickPct: 3, chgOn: true, chgPct: 5, ampOn: true, ampPct: 5 }, { sym: '600219', mkt: 'a', name: '南山铝业', price: 4.4, quick: null, ...st3, on: true, winMin: 5, quickPct: 3, chgOn: true, chgPct: 5, ampOn: false, ampPct: 5 }], webhooks: WH, running: { lastRunTs: Date.UTC(2026, 9, 18, 3, 0), paused: false }, alerts: [] };
  assert(liveTable(fakeS.rows).includes('$64321') && liveTable(fakeS.rows).includes('¥4.40'), 'liveTable 现价两币种格式');
  const b = buildSave(fakeS, true, { '600219': { on: false } });
  assert(b.paused === true && b.tasks['600219'].on === false && b.tasks['600219'].chgPct === 5 && b.tasks.BTC.on === true, 'buildSave 覆盖A股行且币圈行透传');
  assert(buildSave(fakeS, null, null).paused === false && buildSave(fakeS, null, { X: { on: false } }).paused === false, '无暂停覆盖时透传 cfg');
  assert(cfgRow(fakeS.rows[0]).includes('data-k="BTC.quickPct"') && cfgRow(fakeS.rows[1]).includes('data-k="600219.chgPct"') && cfgRow(fakeS.rows[1]).includes('南山铝业'), 'cfgRow 字段/A股中文名');
  assert(!cfgRow(fakeS.rows[1]).includes('ampOn" type="checkbox" checked'), 'A股振幅默认关不勾');
  assert(alertTr({ ts: 0, sym: 'BTC', rule: 'quick', kind: 'recover', text: 'x<y', sendOk: false, err: 'boom' }, {}).includes('&lt;') && alertTr({ ts: 0, sym: 'b', rule: 'test', kind: 'fire', text: 't', sendOk: true, err: '' }, {}).includes('测试'), 'alertTr 转义与规则名');
  assert(alertTr({ ts: 0, sym: '600219', rule: 'dayChg', kind: 'fire', text: 't', sendOk: true, err: '' }, { '600219': '南山铝业 600219' }).includes('南山铝业'), 'alertTr 用名映射');
  const strip = statStrip({ ...fakeS, todayFire: 2, firing: 1, running: { ...fakeS.running, paused: true } });
  assert(strip.includes('已全局暂停') && !strip.includes('hb') && !strip.includes('币圈群'), 'statStrip 暂停态静止(无心跳点)、webhook 状态已移出状态条');
  assert(statStrip({ ...fakeS, todayFire: 0, firing: 0 }).includes('class="hb"'), 'statStrip 运行态挂心跳呼吸点');
  const G = groups(fakeS);
  assert(G.length === 2 && G[0].cap === '币圈' && G[0].rows.length === 1 && G[0].rows[0].sym === 'BTC' && G[1].cap === 'A股' && G[1].rows[0].sym === '600219', 'groups 两块分市场');
  const gc = G.map(gcap).join('');
  assert(gc.includes('币圈小剧场') && gc.includes('✓ …abcd1234 ·加签') && gc.includes('A股大舞台') && gc.includes('✗ 未配置') && gc.includes('~/.lark_webhook_astock'), 'gcap 群名+webhook 状态(未配置提示落 A股文件)');
  assert(!liveTable(G[0].rows).includes('data-sw') && liveTable(G[0].rows).includes('● 正常') && cfgTable(G[1].rows).includes('data-k="600219.winMin"'), 'liveTable 开关列已删/pill 并入/cfgTable 按组出表');
  assert(alertMkt({ sym: '600219' }) === 'a' && alertMkt({ sym: 'BTC' }) === 'c' && alertMkt({ sym: '—' }) === 'c' && alertMkt({ sym: 'x', mkt: 'a' }) === 'a', 'alertMkt 六位码判 A股、旧测试行落币圈、带 mkt 用 mkt');
  assert(alertMkt({ sym: '510300' }) === 'a', 'ETF 六位码归 A股历史筛选');
  // ETF 暴量面板(2026-10-29)
  assert(volG(3.4, 3, true).includes('ff') && volG(3.4, 3, true).includes('3.40×') && volG(1.5, 3).includes('ac'), 'volG 倍数文案、越限琥珀/未越限蓝');
  assert(volG(null, 3).includes('—') && volG(2, 0).includes('gz dim'), 'volG 无读数/无阈值');
  const etfS = { cfg: { on: true, ratio: 3, minAmt: 20 }, rows: [
    { sym: '510300', name: '沪深300ETF华泰柏瑞', price: 4.12, chgPct: -0.77, amtYi: 39.1, ratio: 3.42, min: 211, st: 'fire', since: 1 },
    { sym: '510050', name: '上证50ETF华夏', price: 2.875, chgPct: 0.31, amtYi: 21.8, ratio: 0.72, min: 211, st: 'ok', since: null },
  ] };
  const et = etfTable(etfS);
  assert(et.includes('▲ 暴量') && et.includes('● 正常') && et.includes('3.42×') && et.includes('39.1亿') && et.includes('¥4.12') && et.includes('+0.31%'), 'etfTable 状态/量比/金额/现价/涨跌');
  assert(et.includes('data-k="etf.ratio"') && et.includes('data-k="etf.minAmt"') && et.includes('data-k="etf.on"'), 'etfTable 参数表全局一套');
  assert(etfTable({ ...etfS, cfg: { ...etfS.cfg, on: false } }).includes('⏸ 停用'), 'etfTable 总开关关=停用药丸');
  const JF = [
    { label: 'com.tianhui.bit-radar', title: '币圈雷达 · 晚间', desc: '完整雷达→币圈群', at: '21:00', loaded: true, lastRun: Date.UTC(2026, 9, 18, 13, 0) },
    { label: 'com.tianhui.stock-recap', title: '每日三个锦囊', desc: 'a<b', at: '23:00', loaded: false, lastRun: null },
    { label: 'com.tianhui.holdings-recap', title: '每日持仓复盘', desc: 'x', at: null, loaded: false, lastRun: null, err: 'boom<&' },
  ];
  const jt = jobsTable(JF, Date.UTC(2026, 9, 18, 15, 0));
  assert(jt.includes('data-save="com.tianhui.bit-radar"') && jt.includes('value="21:00"') && jt.includes('● 已加载') && jt.includes('⏸ 未加载') && jt.includes('10-18 21:00') && jt.includes('2小时前'), 'jobsTable 时间/状态/最近运行(含相对时间)');
  assert(jt.includes('title="boom&lt;&amp;"') && jt.includes('data-tg="com.tianhui.stock-recap" data-on="1">启用') && jt.includes('data-on="0">停用') && !jt.includes('a<b') && jt.includes('data-at="com.tianhui.holdings-recap" value=""'), 'jobsTable 读取失败行+启停按钮方向+转义+缺时间空值');
  assert(jobsTable([]).includes('jobs.json') && jobsTable(null).includes('jobs.json'), 'jobsTable 空态给清单提示');
  console.log('monitor.js selftest ok');
}
