import { Provide } from '@midwayjs/core';
import { InjectDataSource } from '@midwayjs/typeorm';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

// 浏览:MySQL 表 stat_view,一个 (页面,IP) 一行,每打开一次 views+1(2026-09-20 用户要求,建表语句在 data/mysql.sql)。
// 总浏览量 = SUM(views),可直接查表。点赞:仍在 data/stats.json(IP哈希永久去重)。
// 展示赞数 = LIKE_BASE(88) + 真实数,便于以后改数。

export const LIKE_BASE = 88;

export type StatRow = {
  likes: number;
  likers: Record<string, boolean>;
};
export type StatsStore = Record<string, StatRow>;

export const blank = (): StatRow => ({ likes: 0, likers: {} });

export const hashIp = (ip: string) =>
  createHash('sha256').update(ip + '|my_money_stats').digest('hex').slice(0, 16);

// 纯函数:返回 {next, changed},不改入参,便于单测
export function applyLike(store: StatsStore, page: string, id: string) {
  const row = store[page] || blank();
  if (row.likers[id]) return { next: store, changed: false };
  const next = { ...store, [page]: { ...row, likes: row.likes + 1, likers: { ...row.likers, [id]: true } } };
  return { next, changed: true };
}

@Provide()
export class StatsService {
  @InjectDataSource('datasource1')
  db: DataSource;

  private file = join(__dirname, '../../data/stats.json');
  private cache: StatsStore | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private viewCache: Record<string, number> = {}; // 库里查不到时(挂库)兜底展示用

  private async load(): Promise<StatsStore> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  // 写盘串行化,失败吞掉(下次请求还会带内存态再写)
  private persist() {
    this.pending = this.pending.then(() =>
      fs.writeFile(this.file, JSON.stringify(this.cache, null, 1)).catch(() => {})
    );
    return this.pending;
  }

  async get(page: string) {
    let views = 0;
    try {
      const r = await this.db.query('SELECT COALESCE(SUM(views),0) v FROM stat_view WHERE page = ?', [page]);
      views = Number(r[0].v);
      this.viewCache[page] = views;
    } catch {
      views = this.viewCache[page] ?? 0; // 库不可用时用内存里最后一次读数
    }
    const row = (await this.load())[page];
    return { views, likes: LIKE_BASE + (row?.likes ?? 0) };
  }

  async view(page: string, ip: string) {
    try {
      await this.db.query(
        'INSERT INTO stat_view (page, ip, views) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE views = views + 1',
        [page, ip]
      );
    } catch {
      /* 挂库少记一次,不白屏 */
    }
    return { ...(await this.get(page)) };
  }

  async like(page: string, ip: string) {
    const { next, changed } = applyLike(await this.load(), page, hashIp(ip));
    if (changed) {
      this.cache = next;
      await this.persist();
    }
    return { ...(await this.get(page)), changed };
  }
}
