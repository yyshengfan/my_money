import { Middleware, IMiddleware } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';

// 只守数据 API:个人财务(/money)+ 持仓(/api/holding)。
// 静态页不守(HTML 本身无秘密),页面 JS 收到 401 自己跳登录页。
const PROTECT = /^\/(money|api\/holding)(\/|$)/;

@Middleware()
export class AuthMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
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
