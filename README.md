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

4. typeorm-model-generator -h 127.0.0.1 -p 3306 -d tianhuiaccount -u root -x Th21211314~~ -e mysql -o ./src/entity


node scripts/seed_user.js <用户名> <新密码>

## 生产服务控制(本机 launchd,2026-10 起唯一运行机器)

两个开机自启任务:`com.tianhui.my-money.prod`(http://127.0.0.1:7001)、`com.tianhui.my-money.tunnel`(cloudflared → https://www.thrr.cc)。

```bash
# 看状态(有 PID=在跑;第二列是上次退出码)
launchctl list | grep my-money

# 改了代码后发布(必须 build + 重启,launchd 只在启动那刻加载 dist)
npm run build && launchctl kickstart -k gui/$(id -u)/com.tianhui.my-money.prod

# 只重启隧道(网站打不开、隧道日志报错时)
launchctl kickstart -k gui/$(id -u)/com.tianhui.my-money.tunnel

# 日志
tail -50 ~/Library/Logs/my-money-prod.log        # 应用
tail -50 ~/Library/Logs/my-money-tunnel.err.log  # 隧道(cloudflared 的 INF/ERR 在这个文件)
```

### 网站打不开时的排查顺序

```bash
# 1. 本机服务活着吗(期望 302)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7001/

# 2. 隧道连云端了吗(看日志最新有无 Registered tunnel connection、有无 ERR 掉线)
grep -E "Registered tunnel connection|ERR" ~/Library/Logs/my-money-tunnel.err.log | tail -5

# 3. 域名解析到 CF 边缘了吗(期望 104.21.x / 172.67.x)
dig www.thrr.cc @1.1.1.1 +short
```

- 本机直连 `https://www.thrr.cc` 会 TLS reset(中国网络直连 CF 抽风),**属已知现象,不代表网站挂了**;要用手机 4G 或挂代理验证。
- 1/2/3 都正常但外部仍打不开 → 大概率旧机器/路由器断网窗口期,隧道会自动重连;等一分钟再试,或 kickstart 隧道(上面的命令)。
- 隧道日志反复 `network is unreachable` → 本机网络断了,先修网络,任务会自愈。
- 页面海外源报 `connect ECONNREFUSED 127.0.0.1:7892` → 本机代理(登塔/Dengta,监听 7892)没在跑。海外接口全靠它(见 `src/util/net.ts`),**把代理 App 打开即自愈,无需重启服务**;新机器记得让代理 App 开机自启。