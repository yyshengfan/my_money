"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Money_1 = require("../entity/entities/Money");
exports.default = {
    // use for cookie sign key, should change to your own and keep security
    keys: '1715828458675_5336',
    koa: {
        port: 7001,
    },
    typeorm: {
        dataSource: {
            datasource1: {
                name: 'datasource1',
                host: 'k8s-istiosys-risktest-8320a1b63f-0e68ef52f61bb987.elb.ap-southeast-1.amazonaws.com',
                type: 'mysql',
                port: 3309,
                username: 'root',
                password: 'mysql.cht-devbase',
                database: 'my_account',
                entities: [Money_1.Money],
                synchronize: false,
                logging: true,
            },
        },
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmRlZmF1bHQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY29uZmlnL2NvbmZpZy5kZWZhdWx0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBU0Esb0RBQWlEO0FBRWpELGtCQUFlO0lBQ2IsdUVBQXVFO0lBQ3ZFLElBQUksRUFBRSxvQkFBb0I7SUFDMUIsR0FBRyxFQUFFO1FBQ0gsSUFBSSxFQUFFLElBQUk7S0FDWDtJQUNELE9BQU8sRUFBRTtRQUNQLFVBQVUsRUFBRTtZQUNWLFdBQVcsRUFBRTtnQkFDWCxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsSUFBSSxFQUFFLG9GQUFvRjtnQkFDMUYsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsUUFBUSxFQUFFLE1BQU07Z0JBQ2hCLFFBQVEsRUFBRSxtQkFBbUI7Z0JBQzdCLFFBQVEsRUFBRSxZQUFZO2dCQUN0QixRQUFRLEVBQUUsQ0FBQyxhQUFLLENBQUM7Z0JBQ2pCLFdBQVcsRUFBRSxLQUFLO2dCQUNsQixPQUFPLEVBQUUsSUFBSTthQUNkO1NBQ0Y7S0FDRjtDQUNjLENBQUMifQ==