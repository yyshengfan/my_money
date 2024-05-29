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
exports.MainConfiguration = void 0;
const core_1 = require("@midwayjs/core");
const koa = require("@midwayjs/koa");
const validate = require("@midwayjs/validate");
const info = require("@midwayjs/info");
const path_1 = require("path");
// import { DefaultErrorFilter } from './filter/default.filter';
// import { NotFoundFilter } from './filter/notfound.filter';
const report_middleware_1 = require("./middleware/report.middleware");
const orm = require("@midwayjs/typeorm");
let MainConfiguration = class MainConfiguration {
    async onReady() {
        // add middleware
        this.app.useMiddleware([report_middleware_1.ReportMiddleware]);
        // add filter
        // this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);
    }
};
__decorate([
    (0, core_1.App)('koa'),
    __metadata("design:type", Object)
], MainConfiguration.prototype, "app", void 0);
MainConfiguration = __decorate([
    (0, core_1.Configuration)({
        imports: [
            orm,
            koa,
            validate,
            {
                component: info,
                enabledEnvironment: ['local'],
            },
        ],
        importConfigs: [(0, path_1.join)(__dirname, './config')],
    })
], MainConfiguration);
exports.MainConfiguration = MainConfiguration;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlndXJhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9jb25maWd1cmF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFBLHlDQUFvRDtBQUNwRCxxQ0FBcUM7QUFDckMsK0NBQStDO0FBQy9DLHVDQUF1QztBQUN2QywrQkFBNEI7QUFDNUIsZ0VBQWdFO0FBQ2hFLDZEQUE2RDtBQUM3RCxzRUFBa0U7QUFDbEUseUNBQXlDO0FBY2xDLElBQU0saUJBQWlCLEdBQXZCLE1BQU0saUJBQWlCO0lBSTVCLEtBQUssQ0FBQyxPQUFPO1FBQ1gsaUJBQWlCO1FBQ2pCLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUMsb0NBQWdCLENBQUMsQ0FBQyxDQUFDO1FBQzNDLGFBQWE7UUFDYiw0REFBNEQ7SUFDOUQsQ0FBQztDQUNGLENBQUE7QUFUQztJQUFDLElBQUEsVUFBRyxFQUFDLEtBQUssQ0FBQzs7OENBQ1U7QUFGVixpQkFBaUI7SUFaN0IsSUFBQSxvQkFBYSxFQUFDO1FBQ2IsT0FBTyxFQUFFO1lBQ1AsR0FBRztZQUNILEdBQUc7WUFDSCxRQUFRO1lBQ1I7Z0JBQ0UsU0FBUyxFQUFFLElBQUk7Z0JBQ2Ysa0JBQWtCLEVBQUUsQ0FBQyxPQUFPLENBQUM7YUFDOUI7U0FDRjtRQUNELGFBQWEsRUFBRSxDQUFDLElBQUEsV0FBSSxFQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsQ0FBQztLQUM3QyxDQUFDO0dBQ1csaUJBQWlCLENBVTdCO0FBVlksOENBQWlCIn0=