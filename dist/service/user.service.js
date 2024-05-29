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
exports.UserService = void 0;
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
let UserService = class UserService {
    async getUser() {
        const money = await this.money.find();
        return money;
    }
    async createNew() {
        const money = await this.money.create();
        return money;
    }
};
__decorate([
    (0, typeorm_1.InjectEntityModel)(Money_1.Money, 'datasource1'),
    __metadata("design:type", typeorm_2.Repository)
], UserService.prototype, "money", void 0);
UserService = __decorate([
    (0, core_1.Provide)()
], UserService);
exports.UserService = UserService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlci5zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NlcnZpY2UvdXNlci5zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFBOzs7Ozs7O0dBT0c7QUFDSCx5Q0FBeUM7QUFDekMsK0NBQXNEO0FBQ3RELG9EQUFpRDtBQUNqRCxxQ0FBcUM7QUFHOUIsSUFBTSxXQUFXLEdBQWpCLE1BQU0sV0FBVztJQUt0QixLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUN0QyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxLQUFLLENBQUMsU0FBUztRQUNiLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUN4QyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7Q0FDRixDQUFBO0FBWEM7SUFBQyxJQUFBLDJCQUFpQixFQUFDLGFBQUssRUFBRSxhQUFhLENBQUM7OEJBQ2pDLG9CQUFVOzBDQUFRO0FBSGQsV0FBVztJQUR2QixJQUFBLGNBQU8sR0FBRTtHQUNHLFdBQVcsQ0FhdkI7QUFiWSxrQ0FBVyJ9