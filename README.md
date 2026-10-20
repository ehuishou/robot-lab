# Robot Lab · 沙地运输场

组装机器人，驾驶通过同一张100m地图，以时间、电量、运输与预算四项计分。没有难度选择。产品规则以 [现行 SSOT](IMPROVEMENT_PLAN.md) 为准。

运行 npm install 后使用 npm run dev，打开 http://localhost:3001/。preview.html 是同一游戏的兼容入口。构建：npm run build；预览：npm run preview。端口固定3001。

沙地不可绕行，所有底盘减速，履带损失最小。中途可装8kg货物和充能；四足能直接翻过拱桥，其他底盘选择平地旁路。清开一个大碎料箱后，在95m交付，驶至100m结算。空载抵达也可结算，但没有运输分。

键盘 W/↑ 或 D 前进，S/↓ 或 A 倒退，Space刹车，E装卸；路口停稳使用选路按钮，充能和清箱使用作业按钮。手机使用屏幕按钮。正式模式预算500、限时180秒；?test=1开启资源测试，测试成绩不计入正式最高分。

## 代码结构

- src/content/：唯一地图、模块目录与模型资产定义。
- src/domain/：配置校验、任务状态、评分与运动物理。
- src/app/、src/input/：界面、存档、固定步长会话控制与输入。
- src/render/：Three.js场景、机器人模型与动画。
- src/testing/：隔离的测试模式策略。
- scripts/：当前地图、浏览器与物理验证；共享TypeScript加载器。

旧Phaser系统、旧难度关卡与旧奖励分支已移除。当前存档键及兼容入口保留。历史设计文档集中在 docs/archive/，历史截图和部署产物保留用于追溯。

## 验证与部署

~~~sh
npm run build
npm test
npm run test:physics
npm run test:browser
~~~

覆盖范围见 [TESTING.md](TESTING.md)，证据在 docs/evidence/single-map/。部署方法见 [deploy/README.md](deploy/README.md)，实际发布记录见 [deploy/DEPLOYED.md](deploy/DEPLOYED.md)。
