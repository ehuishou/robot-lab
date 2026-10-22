# 2026-10-22 排行榜手动添加与不限游戏分数范围版部署记录

- 当前构建：build-f7bdf25ee04c-20261022153829443；Git标签single-map-v3.2；计分规则保持single-map-v3。
- 游戏：http://121.199.30.133:3001/；独立排行榜：http://121.199.30.133:3001/leaderboard.html。游戏内仍无排行榜入口，教程继续暂停。
- 管理员登录后可添加昵称和成绩；添加、修改与重启数据校验均支持超出游戏0–5000范围的安全整数，允许负数。重复昵称提示使用修改功能，保留一昵称一记录。
- 手动成绩标记为“管理员手动成绩”，新增记录不伪造挑战数据；手机超长成绩独占一行显示，避免溢出或数字堆叠。
- 上传包SHA-256：58856b2c7ba70e038a1ae1ac4b72b7166362ef86c3c84e6362762a89d98d9a9b。远端校验后执行deploy/update.sh，静态及API均已切换。
- 上一构建：build-2b88074d841b-20261022150238621；静态目录、API容器与Nginx配置备份均保留。
- 本地构建、9项API检查及11项浏览器检查通过。覆盖未登录拒绝添加、重复昵称、并发版本、非法分数、负数编辑、超大整数重启保留、手机布局及管理添加/修改/删除。
- 公网6个页面、2个API和全部5个当前JS/CSS资源逐字节校验通过；线上以独立QA昵称添加999999分、修改为9007199254740991分后删除，确认现有榜单记录未变。证据见docs/evidence/single-map/leaderboard-admin-deployed.json及deployment-http.json。
- 成绩文件部署前后SHA-256均为818c8ad55d75ac0b149457c724cb8434daa96647bbea098c2e4798a962891e91；线上QA验证会递增修订号，测试记录已清除。沿用既有管理密码。
- 回滚须同时恢复上一静态目录、API及/opt/robot-lab/nginx.before-build-f7bdf25ee04c-20261022153829443.conf（原位写入并验证、重载），保留成绩目录；上一补丁的API不支持超出0–5000的手动成绩，已有此类数据时须保留新API或先显式迁移，禁止直接启动旧API。

---

# 2026-10-22 手机昵称确认补丁部署记录

- 当前构建：build-2b88074d841b-20261022150238621；Git标签single-map-v3.1；计分规则保持single-map-v3。
- 游戏：http://121.199.30.133:3001/；独立排行榜：http://121.199.30.133:3001/leaderboard.html。
- 修复手机输入昵称后确认按钮因失焦收起键盘而移动、点击落空的问题；短屏确认按钮保持可见，支持回车提交。教程继续暂停。
- 上传包SHA-256：2cc0d610e6d16ee7aa39aaefe975160bf032afbb506a5b059618583e9f23f343。远端校验后执行deploy/update.sh，current和api-current均切换成功。
- 上一构建：build-ebfa380adf61-20261022142334460；静态目录、API容器与Nginx备份均保留。
- 本地10项UI检查及公网5项昵称检查通过；6个页面、2个API与5个当前资源哈希检查通过。键盘收起通过模拟验证，尚无真机软键盘验收。
- 成绩文件发布前后SHA-256均为818c8ad55d75ac0b149457c724cb8434daa96647bbea098c2e4798a962891e91；未改动既有成绩和管理密码。
- 回滚时按既有流程同时恢复上一静态软链接、上一API容器及配置备份/opt/robot-lab/nginx.before-build-2b88074d841b-20261022150238621.conf；Nginx配置须原位写入并验证、重载，不覆盖数据目录。

---

# 2026-10-22 昵称计分与独立排行榜版部署记录

- 游戏地址：http://121.199.30.133:3001/；独立排行榜：http://121.199.30.133:3001/leaderboard.html。游戏内无排行榜入口。
- 当前构建：build-ebfa380adf61-20261022142334460；规则 single-map-v3；Git版本标签 single-map-v3。
- 上一构建：build-dc3ac7b92de3-20261022124726122（single-map-v2），发布目录保留。
- 本次更新：前进、倒车均可在分岔检测区选路；全部电机的四足均可高效率翻桥；昵称进入与正式成绩保存；同一规范化昵称仅保留最高分；排行榜支持密码登录后修改与删除。教程开发暂停，测试模式入口沿用上一版本。
- 上传包SHA-256：5a463bdb2058df054676f21a523d4c24a39aca03a872add8736a3d91e1d93b66。远端校验后通过 deploy/update.sh 发布。
- 静态发布目录：/opt/robot-lab/releases/build-ebfa380adf61-20261022142334460，current已指向该版本；现有robot-lab容器与3001端口继续使用。
- API目录：/opt/robot-lab/services/build-ebfa380adf61-20261022142334460；容器robot-lab-api-build-ebfa380adf61-20261022142334460。API通过Docker内部网络由Nginx代理，无额外公网端口；api-current记录当前容器。
- 数据保存在/opt/robot-lab/data，管理密码保存在/opt/robot-lab/secrets/admin-password；两个目录权限700，密码文件600。凭据、数据和后端源码均不在静态站点根目录。本地密码文件deploy/.leaderboard-admin-password.txt已被Git忽略。
- 公网6个页面入口HTTP200且构建ID一致，2个API检查通过，全部5个JS/CSS资源与本地SHA-256一致，见docs/evidence/single-map/deployment-http.json。
- 公网浏览器11项通过，无未捕获JavaScript异常。低功耗电机四足完成翻桥、充能、清障、交付及正式计分：3374分，92.0秒，剩余能量40.3411632348。倒车返回分岔后可重新选路；手机横竖屏场景布局稳定。
- 公网排行榜5组验收通过：真实成绩保存、同昵称最高分、匿名修改被拒绝、管理员修改、专用QA成绩删除及退出登录。只清理QA-browser测试记录，未修改其他玩家数据。见docs/evidence/single-map/leaderboard-deployed.json。
- Nginx发布前配置备份：/opt/robot-lab/nginx.before-build-ebfa380adf61-20261022142334460.conf。更新及回滚必须原位写入nginx.conf以保留容器绑定挂载的inode。

回滚至v2时需要同时回滚静态站点和代理配置。以下为需要时执行的命令，本次发布未执行回滚；数据与密码目录应保留：

```sh
docker stop robot-lab-api-build-ebfa380adf61-20261022142334460
ln -s releases/build-dc3ac7b92de3-20261022124726122 /opt/robot-lab/current.rollback
mv -Tf /opt/robot-lab/current.rollback /opt/robot-lab/current
cat /opt/robot-lab/nginx.before-build-ebfa380adf61-20261022142334460.conf > /opt/robot-lab/nginx.conf
docker exec robot-lab nginx -t
docker exec robot-lab nginx -s reload
mv /opt/robot-lab/api-current /opt/robot-lab/api-current.v3-rollback
```

v2没有API服务，移出api-current可避免下次部署把已停用的v3服务误当成上一版本。后续再次发布v3时可复用保留的数据和密码。

# 2026-10-22 单地图操作与平衡优化版部署记录

- 访问地址：http://121.199.30.133:3001/
- 当前构建：build-dc3ac7b92de3-20261022124726122；规则 single-map-v2；Git版本标签 single-map-v2。
- 上一构建：build-19621c47609a-20261020133734963，发布目录完整保留，可回滚。
- 本次更新：干质量上限放宽至120kg；四足沙地轻微减速且快于轮式；分岔及终点增加提醒；手机组件区支持原生滑动；选路不再挤压场景；前铲清理大箱耗时缩短至1秒。
- 上传已通过本地验收的原始dist，使用现有 deploy/update.sh 原子切换current，沿用robot-lab容器与3001端口；旧页面所需的哈希资源继续保留。
- 上传包SHA-256：dbf09b498cee766099cf78818ca6b9eb3b6bcdcd96fe5f7e31e230f8d058f22e，远端解包前校验通过。
- 公网5个入口HTTP200、构建ID一致，所有JS/CSS与本地逐字节一致；默认正式模式，?test=1开启测试模式。
- 公网浏览器9项检查全部通过，无未捕获JavaScript异常。真实键盘完成沙地、直行拱桥、充能、清障、交付和终点结算，得3343分；刷新保留成绩，手机触控、暂停和组件原生滑动通过。
- 1366×900、390×844、844×390三种视口下，选路前、选择时和选择后场景边界一致。复核公网手机横屏分岔及桌面终点截图，提醒和操作按钮可见。
- 本地14项领域检查、54套四足配置及底盘动画回归已通过。公网证据见 docs/evidence/single-map/deployment-http.json 与 browser-deployed/；使用本机无头Edge模拟手机视口，尚未覆盖真实手机GPU及其他浏览器。
- 源码、SSOT和验收记录由现有公开仓库 ehuishou/robot-lab 管理，发布标签 single-map-v2 对应该部署构建。

回滚命令（仅需要时执行）：

```sh
ln -s releases/build-19621c47609a-20261020133734963 /opt/robot-lab/current.rollback
mv -Tf /opt/robot-lab/current.rollback /opt/robot-lab/current
```

---
# 2026-10-20 单地图清理版部署记录

- 访问地址：http://121.199.30.133:3001/
- 当前构建：build-19621c47609a-20261020133734963；规则 single-map-v1。
- 上一构建：build-b42a6e22bc62-20261019153834356，发布目录完整保留。
- 本次更新：单地图、四项评分、必经沙地、可绕行四足拱桥、中途充能和运输、单个大碎料箱；清除Phaser及旧版本运行分支，统一模块目录。
- 通过用户提供的SSH密钥上传已验证dist，使用既有 deploy/update.sh 原子切换 current。沿用现有robot-lab容器和3001端口。
- 包SHA-256：1e3aa5e526228059da7db480b1e7cbab53e72e3445829e071edfc7fed2f43a7b，远端解包前校验通过。
- 默认正式模式；?test=1进入独立测试模式。根地址、index.html与preview.html指向同一游戏。
- 公网5个入口HTTP200、构建ID一致；JS/CSS哈希逐一与本地一致。
- 公网浏览器7项检查全部通过，未捕获JavaScript异常：真实键盘完成运输及结算、刷新保留成绩、手机横竖屏布局、触控驾驶及暂停。
- 本地12项规则/存档检查、54套四足配置及底盘动画回归全部通过。证据见 docs/evidence/single-map/，公网浏览器证据在 browser-deployed/。

回滚命令（仅需要时执行）：

```sh
ln -s releases/build-b42a6e22bc62-20261019153834356 /opt/robot-lab/current.rollback
mv -Tf /opt/robot-lab/current.rollback /opt/robot-lab/current
```

---
# 2026-10-19 部署记录

- 访问地址：http://121.199.30.133:3001/
- 正常挑战：http://121.199.30.133:3001/?test=0
- 测试模式：http://121.199.30.133:3001/?test=1
- 当前版本：build-b42a6e22bc62-20261019153834356；challenge-v4 / environment-v2 / work-loss-v2.3。
- 上一版本：build-ec93003c4142-20261018153527868（完整保留，可回滚）。
- 发布方式：通过 SSH 原子执行 deploy/update.sh，current 已切换；robot-lab 容器运行中，主机端口 3001 映射容器 80。
- 公网验证：主页、正常模式入口和测试模式入口均返回 HTTP 200；公网构建 ID 与本地构建一致。
- 本次版本内容：旁路提前分出并延后汇入，使用同材质浅弯辅路，旁路速度接近直行；困难模式仅保留一件 20kg 货物；充电桩位于 58–61m 路中并保持直行通过；任务支持一趟完成。
- 当前发布 HTML 默认正常模式，使用 ?test=1 开启临时测试模式；?test=0 明确回到正常模式。

回滚命令（需要时执行）：

`sh
ln -s releases/build-ec93003c4142-20261018153527868 /opt/robot-lab/current.rollback
mv -Tf /opt/robot-lab/current.rollback /opt/robot-lab/current
`

---
# 2026-10-18 部署记录

- 访问地址：http://121.199.30.133:3001/
- 正常挑战：http://121.199.30.133:3001/?test=0
- 测试模式：http://121.199.30.133:3001/?test=1（沿用默认测试）
- 当前版本：build-ec93003c4142-20261018153527868；challenge-v3 / environment-v2 / work-loss-v2.3。
- 上一版本：build-07860c323606-20261017170918137（完整保留，可回滚）。
- 用户已明确要求部署；发布并完成公网验证时间：2026-10-18T15:53:12.761Z。
- 内容：台阶及障碍实体显示、突出旁路选路与曲线、四足实际转向与接触步态、手机长按输入处理；困难收敛为软土/台阶/碎料三处，充电支路保留。预算、任务目标、定价和电池容量保持。
- 上传已验证dist产物；仅在发布副本的两份HTML中将robot-test-mode设为1，JS/CSS与通过本地验收的构建一致。
- 上传包SHA-256：552d8f63fadbe238aba4f07208f5c1aa995093877ff22d189e2fbabb25e61749；9个打包文件远端校验通过，8个公开静态文件公网SHA-256逐一一致。
- deploy/update.sh原子切换current；robot-lab容器继续运行，3001映射80，nginx -t、服务器HTTP200通过。
- 本地构建通过；领域数值26/26，24次运行23次成功及1次预期耗尽失败，去重简单7/普通7/困难6套通关；环境16/16，S11路径9/9，最终浏览器专项10/10，完整UI任务7项通过。各报告见SSOT S11.9和下方manifest。
- 公网浏览器：docs/evidence/deploy-browser-1792338682702/report.json，7/7通过、无未捕获异常、构建ID一致；覆盖入口和资源200、默认测试及正常切换、三档预算、challenge-v3/work-loss-v2.3、390×844触摸驾驶/稳定布局/长按事件与暂停。
- 证据与包：docs/evidence/deploy-build-ec93003c4142-20261018153527868/manifest.json。
- 边界：Android/iOS真机系统选区拖柄、连续视觉录像及用户视觉复核仍待验，Edge/CDP模拟不替代真机。简化游戏动力学边界见SSOT，不宣称全部S11验收条件关闭。
- 历史v2发布证据：docs/evidence/deploy-build-07860c323606-20261017170918137/manifest.json。

回滚命令（需要时执行）：

```sh
ln -s releases/build-07860c323606-20261017170918137 /opt/robot-lab/current.rollback
mv -Tf /opt/robot-lab/current.rollback /opt/robot-lab/current
```
