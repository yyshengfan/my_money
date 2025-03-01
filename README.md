<!--
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-28 18:20:04
 * @FilePath: /my_money/README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# my_midway_project

## QuickStart

<!-- add docs here for user -->

see [midway docs][midway] for more detail.

### Development

```bash
$ npm i
$ npm run dev
$ open http://localhost:7001/
```

### Deploy

```bash
$ npm start
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.


[midway]: https://midwayjs.org


### 生成entity
1. npm install midwayjs/core midwayjs/decorator midwayjs/typeorm typeorm
2. npm install -g typeorm
3. npm install -g typeorm-model-generator
4. typeorm-model-generator -h k8s-istiosys-risktest-8320a1b63f-0e68ef52f61bb987.elb.ap-southeast-1.amazonaws.com -p 3309 -d my_account -u root -x mysql.cht-devbase -e mysql -o ./src/entity

4. typeorm-model-generator -h devtest-risk-common-mysql-cluster.master.devtest-storage.ww5sawfyut0k.bitsvc.io -p 3306 -d ty_test -u app_user -x PLO75FbcfmFYRuQEGmygZ9PyQCQbmgeD5 -e mysql -o ./src/entity


