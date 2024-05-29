import { Context } from '@midwayjs/koa';
import { MoneyService } from '../service/money.service';
import { MoneyDTO } from '../dto/money.dto';
export declare class APIController {
    ctx: Context;
    moneyService: MoneyService;
    getUser(params: MoneyDTO): Promise<{
        success: boolean;
        message: string;
        data: import("typeorm").InsertResult;
    }>;
}
