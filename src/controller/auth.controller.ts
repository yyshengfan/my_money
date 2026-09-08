import { ALL, Body, Controller, Get, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthService } from '../service/auth.service';
import { LoginDTO } from '../dto/login.dto';

@Controller('/api')
export class AuthController {
  @Inject()
  ctx: Context;

  @Inject()
  authService: AuthService;

  @Post('/login')
  async login(@Body(ALL) params: LoginDTO) {
    const username = await this.authService.login(params.username, params.password);
    if (!username) {
      this.ctx.status = 401;
      return { success: false, message: '账号或密码错误', data: null };
    }
    return { success: true, message: 'OK', data: { username } };
  }

  @Post('/logout')
  async logout() {
    this.authService.logout();
    return { success: true, message: 'OK', data: null };
  }

  // 不守卫:前端用它显示登录态
  @Get('/me')
  async me() {
    const user = (this.ctx as any).session?.user ?? null;
    return { success: true, message: 'OK', data: { user } };
  }
}
