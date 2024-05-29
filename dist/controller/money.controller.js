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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIController = void 0;
/*
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-29 11:18:27
 * @FilePath: /my_money/src/controller/api.controller.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const core_1 = require("@midwayjs/core");
const money_service_1 = require("../service/money.service");
const money_dto_1 = require("../dto/money.dto");
let APIController = class APIController {
    async getUser(params) {
        const res = await this.moneyService.createNew(params);
        return { success: true, message: 'OK', data: res };
    }
};
__decorate([
    (0, core_1.Inject)(),
    __metadata("design:type", Object)
], APIController.prototype, "ctx", void 0);
__decorate([
    (0, core_1.Inject)(),
    __metadata("design:type", money_service_1.MoneyService)
], APIController.prototype, "moneyService", void 0);
__decorate([
    (0, core_1.Post)('/create'),
    __param(0, (0, core_1.Body)(core_1.ALL)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [money_dto_1.MoneyDTO]),
    __metadata("design:returntype", Promise)
], APIController.prototype, "getUser", null);
APIController = __decorate([
    (0, core_1.Controller)('/money')
], APIController);
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXkuY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb250cm9sbGVyL21vbmV5LmNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7R0FPRztBQUNILHlDQUFxRTtBQUVyRSw0REFBd0Q7QUFDeEQsZ0RBQTRDO0FBR3JDLElBQU0sYUFBYSxHQUFuQixNQUFNLGFBQWE7SUFRbEIsQUFBTixLQUFLLENBQUMsT0FBTyxDQUFZLE1BQWdCO1FBQ3ZDLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDdEQsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUM7SUFDckQsQ0FBQztDQUNGLENBQUE7QUFYQztJQUFDLElBQUEsYUFBTSxHQUFFOzswQ0FDSTtBQUViO0lBQUMsSUFBQSxhQUFNLEdBQUU7OEJBQ0ssNEJBQVk7bURBQUM7QUFHckI7SUFETCxJQUFBLFdBQUksRUFBQyxTQUFTLENBQUM7SUFDRCxXQUFBLElBQUEsV0FBSSxFQUFDLFVBQUcsQ0FBQyxDQUFBOztxQ0FBUyxvQkFBUTs7NENBR3hDO0FBWFUsYUFBYTtJQUR6QixJQUFBLGlCQUFVLEVBQUMsUUFBUSxDQUFDO0dBQ1IsYUFBYSxDQVl6QjtBQVpZLHNDQUFhIn0=