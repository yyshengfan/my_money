#!/usr/bin/env python3
"""BTC/ETH 现货 ETF 净流入全历史回填 → runtime/etf-flows.json(与 crypto.service 逐日累积共用同一文件)。

为什么单独一个 python 脚本:免费源 Farside 的 CF 只放 python-urllib 的 TLS 指纹过
(curl / Node https 均 403),服务端继续用 Supabase 免费函数做逐日增量;本脚本手动隔段时间
跑一次即可把整段历史(Farside 定稿值)补全,服务侧代码零改动、不加子进程依赖。

用法: python3 scripts/etf_backfill.py
Farside 表:每行=交易日,列=各基金当日净流入(US$m,负数用括号),末列=Total。
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

PAGES = {
    "btc": "https://farside.co.uk/bitcoin-etf-flow-all-data/",
    "eth": "https://farside.co.uk/ethereum-etf-flow-all-data/",
}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
MONTH = dict(Jan=1, Feb=2, Mar=3, Apr=4, May=5, Jun=6, Jul=7, Aug=8, Sep=9, Oct=10, Nov=11, Dec=12)
STORE = Path(__file__).resolve().parent.parent / "runtime/etf-flows.json"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")


def parse_flows(html: str):
    """→ {date: 净流入USD};只取形如「11 Jan 2024」开头的行,末列 Total,'(95.1)'=负、'-'=缺。"""
    out = {}
    for tr in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) < 2:
            continue
        m = re.match(r"(\d{1,2}) (\w{3}) (\d{4})$", cells[0])
        if not m or m.group(2) not in MONTH:
            continue
        t = cells[-1].replace(",", "").replace("(", "-").replace(")", "").replace("−", "-")
        if not re.match(r"^-?\d+(\.\d+)?$", t):
            continue  # '-' / 空 = 当日无数据
        out[f"{m.group(3)}-{MONTH[m.group(2)]:02d}-{int(m.group(1)):02d}"] = round(float(t) * 1e6)
    return out


def main():
    store = {"updatedAt": 0, "rows": [], "manual": []}
    if STORE.exists():
        try:
            store.update(json.loads(STORE.read_text()))
        except Exception:
            print("现有台账解析失败,将整档重写(手填 manual 段会丢,确认无手填再跑)")
    by_date = {r["date"]: dict(r) for r in store["rows"]}
    changed = 0
    for key, url in PAGES.items():
        flows = parse_flows(fetch(url))
        assert flows, f"{key} 没解析出任何行,Farside 页面结构可能变了"
        for d, v in flows.items():
            row = by_date.setdefault(d, {"date": d})
            if row.get(key) != v:
                row[key] = v
                changed += 1
        dates = sorted(flows)
        print(f"{key}: {len(flows)} 个交易日 {dates[0]} → {dates[-1]}")
    rows = sorted(by_date.values(), key=lambda r: r["date"])
    STORE.parent.mkdir(exist_ok=True)
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"updatedAt": int(time.time() * 1000), "rows": rows, "manual": store.get("manual", [])}, ensure_ascii=False))
    tmp.replace(STORE)  # 原子替换,与服务端写法规矩一致
    print(f"共 {len(rows)} 行(更新 {changed} 个值)→ {STORE.relative_to(STORE.parent.parent)}")


if __name__ == "__main__":
    sys.exit(main())
