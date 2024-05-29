"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoneyService = void 0;
/*
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-29 11:18:00
 * @FilePath: /my_money/src/service/user.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const core_1 = require("@midwayjs/core");
const typeorm_1 = require("@midwayjs/typeorm");
const Money_1 = require("../entity/entities/Money");
const typeorm_2 = require("typeorm");
const moment = require("moment");
let MoneyService = class MoneyService {
    async createNew(params) {
        const money = await this.getlastRecord();
        const moneyNew = new Money_1.Money();
        // 原声参数
        moneyNew.salary = params.salary;
        moneyNew.inmoney = params.inmoney;
        moneyNew.credit = params.credit;
        moneyNew.periodical = params.periodical;
        moneyNew.fund = params.fund;
        moneyNew.bitAmount = params.bitAmount;
        moneyNew.stockAmount = params.stockAmount;
        moneyNew.zfbAmount = params.zfbAmount;
        moneyNew.comment = params.comment;
        moneyNew.outmoneyOther = params.outmoneyOther;
        moneyNew.outmoneyRent = params.outmoneyRent;
        moneyNew.outmoneyMortgage = params.outmoneyMortgage;
        moneyNew.outmoneySocialSecurity = params.outmoneySocialSecurity;
        // 计算理财
        moneyNew.zfbProfit = params.zfbAmount - money.zfbAmount;
        moneyNew.bitProfit = params.bitAmount - money.bitAmount;
        moneyNew.stockProfit = params.stockAmount - money.stockAmount;
        moneyNew.time = moment().format('YYYY-MM-DD');
        // 计算其他
        moneyNew.money =
            params.inmoney +
                params.periodical +
                params.fund +
                params.bitAmount +
                params.stockAmount +
                params.zfbAmount -
                params.credit;
        moneyNew.outmoneyNet =
            moneyNew.inmoney -
                money.increment -
                params.outmoneyOther -
                params.outmoneyRent -
                params.outmoneyMortgage -
                params.outmoneySocialSecurity;
        moneyNew.increment = moneyNew.money - money.money;
        moneyNew.outmoneyCons = moneyNew.inmoney - money.increment;
        const res = await this.money.insert(moneyNew);
        return res;
    }
    // 获取最后一条
    async getlastRecord() {
        const res = await this.money.find({
            order: { id: 'DESC' },
            take: 1,
        });
        return res[0];
    }
};
__decorate([
    (0, typeorm_1.InjectEntityModel)(Money_1.Money, 'datasource1'),
    __metadata("design:type", typeorm_2.Repository)
], MoneyService.prototype, "money", void 0);
MoneyService = __decorate([
    (0, core_1.Provide)()
], MoneyService);
exports.MoneyService = MoneyService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXkuc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zZXJ2aWNlL21vbmV5LnNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7R0FPRztBQUNILHlDQUF5QztBQUN6QywrQ0FBc0Q7QUFDdEQsb0RBQWlEO0FBQ2pELHFDQUFxQztBQUVyQyxpQ0FBa0M7QUFHM0IsSUFBTSxZQUFZLEdBQWxCLE1BQU0sWUFBWTtJQUt2QixLQUFLLENBQUMsU0FBUyxDQUFDLE1BQWdCO1FBQzlCLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXpDLE1BQU0sUUFBUSxHQUFHLElBQUksYUFBSyxFQUFFLENBQUM7UUFDN0IsT0FBTztRQUNQLFFBQVEsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztRQUNoQyxRQUFRLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFDbEMsUUFBUSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO1FBQ2hDLFFBQVEsQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQztRQUN4QyxRQUFRLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUM7UUFDNUIsUUFBUSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO1FBQ3RDLFFBQVEsQ0FBQyxXQUFXLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQztRQUMxQyxRQUFRLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUM7UUFDdEMsUUFBUSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDO1FBQ2xDLFFBQVEsQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQztRQUM5QyxRQUFRLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7UUFDNUMsUUFBUSxDQUFDLGdCQUFnQixHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztRQUNwRCxRQUFRLENBQUMsc0JBQXNCLEdBQUcsTUFBTSxDQUFDLHNCQUFzQixDQUFDO1FBRWhFLE9BQU87UUFDUCxRQUFRLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUN4RCxRQUFRLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUN4RCxRQUFRLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDLFdBQVcsQ0FBQztRQUM5RCxRQUFRLENBQUMsSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUU5QyxPQUFPO1FBQ1AsUUFBUSxDQUFDLEtBQUs7WUFDWixNQUFNLENBQUMsT0FBTztnQkFDZCxNQUFNLENBQUMsVUFBVTtnQkFDakIsTUFBTSxDQUFDLElBQUk7Z0JBQ1gsTUFBTSxDQUFDLFNBQVM7Z0JBQ2hCLE1BQU0sQ0FBQyxXQUFXO2dCQUNsQixNQUFNLENBQUMsU0FBUztnQkFDaEIsTUFBTSxDQUFDLE1BQU0sQ0FBQztRQUVoQixRQUFRLENBQUMsV0FBVztZQUNsQixRQUFRLENBQUMsT0FBTztnQkFDaEIsS0FBSyxDQUFDLFNBQVM7Z0JBQ2YsTUFBTSxDQUFDLGFBQWE7Z0JBQ3BCLE1BQU0sQ0FBQyxZQUFZO2dCQUNuQixNQUFNLENBQUMsZ0JBQWdCO2dCQUN2QixNQUFNLENBQUMsc0JBQXNCLENBQUM7UUFFaEMsUUFBUSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUM7UUFDbEQsUUFBUSxDQUFDLFlBQVksR0FBRyxRQUFRLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7UUFFM0QsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM5QyxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFRCxTQUFTO0lBQ1QsS0FBSyxDQUFDLGFBQWE7UUFDakIsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNoQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFO1lBQ3JCLElBQUksRUFBRSxDQUFDO1NBQ1IsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDaEIsQ0FBQztDQUNGLENBQUE7QUE3REM7SUFBQyxJQUFBLDJCQUFpQixFQUFDLGFBQUssRUFBRSxhQUFhLENBQUM7OEJBQ2pDLG9CQUFVOzJDQUFRO0FBSGQsWUFBWTtJQUR4QixJQUFBLGNBQU8sR0FBRTtHQUNHLFlBQVksQ0ErRHhCO0FBL0RZLG9DQUFZIn0=