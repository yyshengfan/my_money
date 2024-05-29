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
exports.Money = void 0;
const typeorm_1 = require("typeorm");
let Money = class Money {
};
__decorate([
    (0, typeorm_1.Column)('int', { primary: true, name: 'id', comment: '主键ID' }),
    __metadata("design:type", Number)
], Money.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('date', { name: 'time', nullable: true, comment: '时间' }),
    __metadata("design:type", String)
], Money.prototype, "time", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'salary', nullable: true, comment: '工资' }),
    __metadata("design:type", Number)
], Money.prototype, "salary", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'inmoney', nullable: true, comment: '进账' }),
    __metadata("design:type", Number)
], Money.prototype, "inmoney", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'credit', nullable: true, comment: '信用卡消费' }),
    __metadata("design:type", Number)
], Money.prototype, "credit", void 0);
__decorate([
    (0, typeorm_1.Column)('int', {
        name: 'outmoney_other',
        nullable: true,
        comment: '定向支出',
    }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneyOther", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'outmoney_rent', nullable: true, comment: '房租支出' }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneyRent", void 0);
__decorate([
    (0, typeorm_1.Column)('int', {
        name: 'outmoney_mortgage',
        nullable: true,
        comment: '房贷支出',
    }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneyMortgage", void 0);
__decorate([
    (0, typeorm_1.Column)('int', {
        name: 'outmoney_social_security',
        nullable: true,
        comment: '社保支出',
    }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneySocialSecurity", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'outmoney_cons', nullable: true, comment: '出帐' }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneyCons", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'outmoney_net', nullable: true, comment: '净支出' }),
    __metadata("design:type", Number)
], Money.prototype, "outmoneyNet", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'increment', nullable: true, comment: '增量' }),
    __metadata("design:type", Number)
], Money.prototype, "increment", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'periodical', nullable: true, comment: '存款' }),
    __metadata("design:type", Number)
], Money.prototype, "periodical", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'fund', nullable: true, comment: '基金' }),
    __metadata("design:type", Number)
], Money.prototype, "fund", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'bit_amount', nullable: true, comment: '币余' }),
    __metadata("design:type", Number)
], Money.prototype, "bitAmount", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'bit_profit', nullable: true, comment: 'bit盈亏' }),
    __metadata("design:type", Number)
], Money.prototype, "bitProfit", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'stock_amount', nullable: true, comment: '股余' }),
    __metadata("design:type", Number)
], Money.prototype, "stockAmount", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'stock_profit', nullable: true, comment: 'stock盈亏' }),
    __metadata("design:type", Number)
], Money.prototype, "stockProfit", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'zfb_amount', nullable: true, comment: 'zfb' }),
    __metadata("design:type", Number)
], Money.prototype, "zfbAmount", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'zfb_profit', nullable: true, comment: 'zfb盈亏' }),
    __metadata("design:type", Number)
], Money.prototype, "zfbProfit", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { name: 'money', nullable: true, comment: '余额' }),
    __metadata("design:type", Number)
], Money.prototype, "money", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar', {
        name: 'comment',
        nullable: true,
        comment: '备注',
        length: 255,
    }),
    __metadata("design:type", String)
], Money.prototype, "comment", void 0);
Money = __decorate([
    (0, typeorm_1.Entity)('money', { schema: 'my_account' })
], Money);
exports.Money = Money;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTW9uZXkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0aWVzL01vbmV5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFBLHFDQUF5QztBQUdsQyxJQUFNLEtBQUssR0FBWCxNQUFNLEtBQUs7Q0FtRmpCLENBQUE7QUFsRkM7SUFBQyxJQUFBLGdCQUFNLEVBQUMsS0FBSyxFQUFFLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQzs7aUNBQ25EO0FBRVg7SUFBQyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQzs7bUNBQzVDO0FBRXBCO0lBQUMsSUFBQSxnQkFBTSxFQUFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7O3FDQUMzQztBQUV0QjtJQUFDLElBQUEsZ0JBQU0sRUFBQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDOztzQ0FDM0M7QUFFdkI7SUFBQyxJQUFBLGdCQUFNLEVBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQzs7cUNBQzlDO0FBRXRCO0lBQUMsSUFBQSxnQkFBTSxFQUFDLEtBQUssRUFBRTtRQUNiLElBQUksRUFBRSxnQkFBZ0I7UUFDdEIsUUFBUSxFQUFFLElBQUk7UUFDZCxPQUFPLEVBQUUsTUFBTTtLQUNoQixDQUFDOzs0Q0FDMkI7QUFFN0I7SUFBQyxJQUFBLGdC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