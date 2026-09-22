import { Middleware, IMiddleware } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';

// 只守数据 API:个人财务(/money)+ 持仓(/api/holding)。
// 静态页不守(HTML 本身无秘密),页面 JS 收到 401 自己跳登录页。
const PROTECT = /^\/(money|api\/holding)(\/|$)/;

@Middleware()
export class AuthMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      // 本机直连(无隧道头)补一个 https 标记:能纠正 ctx.secure/ip 的后续读取。
      // ⚠️ 但救不了登录:@midwayjs/cookies 的 Cookies 实例在 session 中间件(比这里更早)
      // 首次触碰 ctx.cookies 时就把 secure 快照死了,晚设的头无效——prod 本机 http 登录/退出仍 500
      // (2026-09-20 实测),本地看页走 dev 或带 X-Forwarded-Proto 头 curl,公网走隧道(必带该头)则一切正常。
      if (!ctx.get('x-forwarded-proto') && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ctx.ip)) {
        ctx.request.headers['x-forwarded-proto'] = 'https';
      }
      const session = (ctx as any).session;
      if (PROTECT.test(ctx.path) && !session?.user) {
        ctx.status = 401;
        ctx.body = { success: false, message: '未登录', data: null };
        return;
      }
      await next();
    };
  }

  static getName(): string {
    return 'auth';
  }
}
