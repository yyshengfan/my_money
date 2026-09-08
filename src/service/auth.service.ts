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

  async login(username: string, password: string): Promise<string | null> {
    const u = await this.usersRepo.findOne({ where: { username } });
    // TODO 临时诊断,查完删
    this.ctx.logger.info(
      'login-dbg',
      JSON.stringify({
        found: !!u,
        hashPrefix: u ? String(u.passHash).slice(0, 8) : null,
        hashLen: u ? String(u.passHash).length : null,
        pwLen: password ? password.length : null,
        ok: u ? verifyPassword(password, u.passHash) : null,
      })
    );
    if (!u || !verifyPassword(password, u.passHash)) return null;
    (this.ctx as any).session.user = { username };
    return username;
  }

  logout() {
    (this.ctx as any).session = null;
  }
}
