// 掘金文章访问:一秒一次,共 10 分钟(600 次)。用法:node scripts/juejin.js [url]
const URL = process.argv[2] || 'https://juejin.cn/post/7696323841456570409';
const N = 600; // 1s × 10min
let done = 0, ok = 0;

const timer = setInterval(async () => {
  const i = ++done;
  try {
    const r = await fetch(URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000), // 单请求 8s 超时,防挂死拖慢节奏
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
    });
    if (r.ok) ok++;
    console.log(`#${i}/${N} ${r.status}(成功 ${ok})`);
  } catch (e) {
    console.log(`#${i}/${N} ERR ${e.message}(成功 ${ok})`);
  }
  if (done >= N) { clearInterval(timer); console.log(`完成:${ok}/${N} 成功`); }
}, 1000);
