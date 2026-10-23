# Robot Lab · 沙地运输场

组装机器人，驾驶通过同一张100m地图，以时间、电量、运输与预算计分。没有难度选择。产品规则以 [现行 SSOT](IMPROVEMENT_PLAN.md) 为准。

沙地必经，所有底盘减速，履带损失最小，四足快于轮式。中途装8kg货物和充能；四足配任意电机均可高效翻桥，其他底盘走旁路。清开一个大碎料箱，在95m交付，100m结算。空载也可结算，但无运输分。

首次输入昵称进入，不需要账号密码。登录后展示七步静态图文教学，完成后进入组装；可从“地图教学”重看。正式成功成绩自动保存，同一昵称仅保留最高分；低分和同分不覆盖。断网暂存并重试。昵称不独占，请避免重名。

排行榜独立页面为 `/leaderboard.html`，与游戏同款UI，游戏中无入口。普通访问只读；独立管理密码登录后可手动添加昵称与成绩、修改昵称/分数、删除成绩；手动成绩不受游戏分数范围限制。API只保存昵称与成绩所需的配置和结算指标，不创建个人资料。身份不认证，评分一致性校验不等于防作弊。

## 本地运行

```sh
npm install
npm run build
```

设置 `ROBOT_ADMIN_PASSWORD`（至少16字符）或 `ROBOT_ADMIN_PASSWORD_FILE`（密码文件绝对路径），然后在一个终端执行 `npm run start:api`，另一个执行 `npm run dev`。打开 http://localhost:3001/；API默认127.0.0.1:3002，Vite自动代理。生产预览使用 `npm run preview`。本地成绩在忽略的 `data/`；可用 `ROBOT_DATA_DIR` 指定其他目录。

键盘 D/→ 前进，A/← 倒退，Space刹车，E交互。手机点击同一个“交互”按钮，根据附近目标执行装载、卸货、充能、清障或平台暂存；作业中显示倒计时，不能重复触发。路口减速用选路按钮，两个路口前进/倒退均可触发。正式预算500、限时180秒；只有在网址输入 `?test=1` 才能开启资源测试（界面无入口），不保存正式成绩。

## 代码结构

- `src/content/`：唯一地图、模块目录与模型资产。
- `src/domain/`：配置校验、任务、评分、昵称规范化与物理。
- `src/app/`、`src/input/`：游戏界面、存档、成绩补传与会话控制。
- `src/render/`：Three.js场景、机器人与动画。
- `src/leaderboard/`、`leaderboard.html`：独立排行榜页面，不加载游戏场景。
- `server/`：无额外依赖的Node成绩API、持久化与管理认证。
- `scripts/`：构建及当前规则的领域、浏览器和物理验证。

旧Phaser、难度关卡及奖励分支已移除，历史设计在 `docs/archive/`。

## 验证与部署

```sh
npm run build
npm test
npm run test:physics
npm run test:browser
npm run test:leaderboard
npm run test:leaderboard:browser
npm run test:tutorial
```

覆盖见 [TESTING.md](TESTING.md)，证据见 `docs/evidence/single-map/`。发布步骤见 [deploy/README.md](deploy/README.md)，实际发布及回滚见 [deploy/DEPLOYED.md](deploy/DEPLOYED.md)。
