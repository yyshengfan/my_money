// 新闻跨源去重(东财按媒体聚合、妙想检索同理:同一事件各家改写只差几个字)
// 精确/包含只是近义改写的特例,故判据用「归一化后最长公共子串」:
// 公共子串 ≥10 字 且 ≥较短标题的一半 —— 数字不同(80亿 vs 1000亿)会把连续公共段截断,不误并。
// 调用方须先按时间倒序传入,保留首见(=最新一条)。
// ponytail: O(n²·L²) LCS,列表十几条无压力;feed 变长再换 simhash。
export function normNewsTitle(t: string): string {
  return String(t || '')
    .toLowerCase()
    .replace(/[^0-9a-z一-龥]+/g, '');
}

// 数字 token 集合(归一化串上的连续数字段);「80亿」与「1000亿」共享尾巴「0亿元…」
// 能撑过 LCS 阈值,靠这个集合的包含关系拦下:一方数字不全在另一方里 → 不同事件
function numSet(s: string): string[] {
  return [...new Set(s.match(/\d+/g) || [])];
}
const numSubset = (a: string[], b: string[]) => a.every(x => b.includes(x));

function lcsLen(a: string, b: string): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) {
      const v = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      cur.push(v);
      if (v > best) best = v;
    }
    prev = cur;
  }
  return best;
}

export function dedupeNews<T extends { title?: string }>(rows: T[]): T[] {
  const kept: { n: string; nums: string[] }[] = [];
  const out: T[] = [];
  for (const r of rows || []) {
    const n = normNewsTitle(r.title);
    if (!n) {
      out.push(r); // 无标题行不去重,原样交给前端
      continue;
    }
    const nums = numSet(n);
    const dup = kept.some(k => {
      const l = lcsLen(n, k.n);
      return (
        l >= 10 &&
        l * 2 >= Math.min(n.length, k.n.length) &&
        (numSubset(nums, k.nums) || numSubset(k.nums, nums))
      );
    });
    if (dup) continue;
    kept.push({ n, nums });
    out.push(r);
  }
  return out;
}
