import { Controller, Get, Inject } from '@midwayjs/core';
import { EventsService } from '../service/events.service';

// 全球事件雷达(未来30日高/中级时间轴 + 覆盖天数),公开端点(AuthMiddleware 正则不匹配 /api/events)。
@Controller('/api/events')
export class EventsController {
  @Inject()
  eventsSrv: EventsService;

  @Get('/')
  async events() {
    return { success: true, message: 'OK', data: await this.eventsSrv.events() };
  }
}
