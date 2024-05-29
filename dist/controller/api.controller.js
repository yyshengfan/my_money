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
const user_service_1 = require("../service/user.service");
let APIController = class APIController {
    async getUser(uid) {
        const user = await this.userService.getUser();
        return { success: true, message: 'OK', data: user };
    }
};
__decorate([
    (0, core_1.Inject)(),
    __metadata("design:type", Object)
], APIController.prototype, "ctx", void 0);
__decorate([
    (0, core_1.Inject)(),
    __metadata("design:type", user_service_1.UserService)
], APIController.prototype, "userService", void 0);
__decorate([
    (0, core_1.Get)('/get_user'),
    __param(0, (0, core_1.Query)('uid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], APIController.prototype, "getUser", null);
APIController = __decorate([
    (0, core_1.Controller)('/api')
], APIController);
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY29udHJvbGxlci9hcGkuY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUFBQTs7Ozs7OztHQU9HO0FBQ0gseUNBQWdFO0FBRWhFLDBEQUFzRDtBQUcvQyxJQUFNLGFBQWEsR0FBbkIsTUFBTSxhQUFhO0lBUWxCLEFBQU4sS0FBSyxDQUFDLE9BQU8sQ0FBZSxHQUFHO1FBQzdCLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUM5QyxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQztJQUN0RCxDQUFDO0NBQ0YsQ0FBQTtBQVhDO0lBQUMsSUFBQSxhQUFNLEdBQUU7OzBDQUNJO0FBRWI7SUFBQyxJQUFBLGFBQU0sR0FBRTs4QkFDSSwwQkFBVztrREFBQztBQUduQjtJQURMLElBQUEsVUFBRyxFQUFDLFdBQVcsQ0FBQztJQUNGLFdBQUEsSUFBQSxZQUFLLEVBQUMsS0FBSyxDQUFDLENBQUE7Ozs7NENBRzFCO0FBWFUsYUFBYTtJQUR6QixJQUFBLGlCQUFVLEVBQUMsTUFBTSxDQUFDO0dBQ04sYUFBYSxDQVl6QjtBQVpZLHNDQUFhIn0=