import { Provide } from '@midwayjs/core';
import { getBuffer, cached } from '../util/net';

export interface QtRow {
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  chg: number;
  chgPct: number;
  time: string;
  amountWan?: number; // 成交额(万元) f37,指数与个股同构;空/0 不写
}

// 腾讯免费行情 qt.gtimg.cn,免鉴权。每行形如:
// v_sh600036="1~招商银行~600036~33.50~33.40~33.45~...~20260904150000~0.10~0.30~33.62~33.30~...~84520.00~...";
// 固定列位:1名称 3现价 4昨收 5今开 30时间 31涨跌 32涨跌幅 33最高 34最低 37成交额(万)(A股/指数/港股同构)
export function parseTencent(text: string): Record<string, QtRow> {
  const out: Record<string, QtRow> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 35 || !f[1]) continue; // 缺列/停牌脏行跳过
    const row: QtRow = {
      name: f[1],
      price: Number(f[3]),
      prevClose: Number(f[4]),
      open: Number(f[5]),
      time: f[30],
      chg: Number(f[31]),
      chgPct: Number(f[32]),
      high: Number(f[33]),
      low: Number(f[34]),
    };
    const amt = f.length > 37 ? Number(f[37]) : NaN;
    if (isFinite(amt) && amt > 0) row.amountWan = amt;
    out[m[1]] = row;
  }
  return out;
}

// 持仓行 → 腾讯代码:港股 5 位码加 hk;A股按首位 6→sh、其余→sz
export function quoteCode(code: string, market: string): string {
  if (market.indexOf('港') >= 0) return 'hk' + code;
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

@Provide()
export class QtService {
  async quotes(codes: string[]): Promise<Record<string, QtRow>> {
    return cached('qt:' + codes.join(','), 60_000, async () => {
      const buf = await getBuffer('https://qt.gtimg.cn/q=' + codes.join(','));
      const TD: any = (globalThis as any).TextDecoder;
      return parseTencent(new TD('gbk').decode(buf));
    });
  }
}
