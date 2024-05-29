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
exports.MoneyDTO = void 0;
/**
 * @description 描述
 * @author hui.tian
 * @date 2022-09-21 14:13:10
 * @last_modified_time 2022-09-21 14:13:10
 */
const validate_1 = require("@midwayjs/validate");
class MoneyDTO {
}
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "salary", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "inmoney", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "credit", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "periodical", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "fund", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "bitAmount", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "stockAmount", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "zfbAmount", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "outmoneyOther", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "outmoneyRent", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "outmoneyMortgage", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.number().max(999999999).required()),
    __metadata("design:type", Number)
], MoneyDTO.prototype, "outmoneySocialSecurity", void 0);
__decorate([
    (0, validate_1.Rule)(validate_1.RuleType.string().trim().max(255).required()),
    __metadata("design:type", String)
], MoneyDTO.prototype, "comment", void 0);
exports.MoneyDTO = MoneyDTO;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uZXkuZHRvLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2R0by9tb25leS5kdG8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7O0dBS0c7QUFDSCxpREFBb0Q7QUFFcEQsTUFBYSxRQUFRO0NBMkJwQjtBQTFCQztJQUFDLElBQUEsZUFBSSxFQUFDLG1CQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDOzt3Q0FDbkM7QUFDZjtJQUFDLElBQUEsZUFBSSxFQUFDLG1CQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDOzt5Q0FDbEM7QUFDaEI7SUFBQyxJQUFBLGVBQUksRUFBQyxtQkFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQzs7d0NBQ25DO0FBQ2Y7SUFBQyxJQUFBLGVBQUksRUFBQyxtQkFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQzs7NENBQy9CO0FBQ25CO0lBQUMsSUFBQSxlQUFJLEVBQUMsbUJBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7O3NDQUNyQztBQUNiO0lBQUMsSUFBQSxlQUFJLEVBQUMsbUJBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7OzJDQUNoQztBQUNsQjtJQUFDLElBQUEsZUFBSSxFQUFDLG1CQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDOzs2Q0FDOUI7QUFDcEI7SUFBQyxJQUFBLGVBQUksRUFBQyxtQkFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQzs7MkNBQ2hDO0FBQ2xCO0lBQUMsSUFBQSxlQUFJLEVBQUMsbUJBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7OytDQUM1QjtBQUN0QjtJQUFDLElBQUEsZUFBSSxFQUFDLG1CQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDOzs4Q0FDN0I7QUFDckI7SUFBQyxJQUFBLGVBQUksRUFBQyxtQkFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQzs7a0RBQ3pCO0FBQ3pCO0lBQUMsSUFBQSxlQUFJLEVBQUMsbUJBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7O3dEQUNuQjtBQUMvQjtJQUFDLElBQUEsZUFBSSxFQUFDLG1CQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDOzt5Q0FDbkM7QUExQmxCLDRCQTJCQyJ9