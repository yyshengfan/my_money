import { Inject, Provide } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Users } from '../entity/entities/Users';

// 口令存 "salt:hex",用 node 内置 scrypt,不引 bcrypt。
// 种子数据里的 pass_hash 用 node -e "console.log(require('./dist/service/auth.service').hashPassword('你的密码'))" 生成
export function hashPassword(password: string, salt?: string): string {
  const s = salt || randomBytes(16).toString('hex');
  return `${s}:${scryptSync(password, s, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const calc = scryptSync(password, salt, 64);
  const want = Buffer.from(hex, 'hex');
  return calc.length === want.length && timingSafeEqual(calc, want);
}

@Provide()
export class AuthService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(Users, 'datasource1')
  usersRepo: Repository<Users>;

  // 2026-09:全站开放登录——只有 tianhui 且密码正确是真账号,其余一律进「演示模式」
  // (session.user.demo,数据 API 返回假持仓/假资产,见 service/demo.ts),永不返回 null
  async login(username: string, password: string): Promise<string> {
    let real = false;
    // 忽略大小写(2026-09-21 修):MySQL 校对 ci 能找到行,JS 的 === 却会把 Tianhui 打成演示
    if (username.toLowerCase() === 'tianhui') {
      const u = await this.usersRepo.findOne({ where: { username } });
      real = !!u && verifyPassword(password, u.passHash);
    }
    (this.ctx as any).session.user = { username, demo: !real };
    return username;
  }

  logout() {
    (this.ctx as any).session = null;
  }
}
