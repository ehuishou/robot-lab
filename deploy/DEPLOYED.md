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
