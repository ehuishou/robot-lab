# 部署单地图版本

当前本地规则为 single-map-v2。根地址、index.html 和 preview.html 都打开同一游戏，默认正式模式；?test=1开启独立测试模式。当前实际线上构建及回滚目标见 DEPLOYED.md。

## 构建与验收

运行 npm run build、npm test、npm run test:physics、npm run test:browser。正常发布时不设置 ROBOT_LAB_TEST_MODE；如需默认测试模式，构建前将该环境变量设为1。配置存档沿用 robot_lab_preview_v1 / robot_lab_preview_test_v1，正式成绩按规则版本隔离。

## 更新已有服务器

上传已验证的 dist/ 与 deploy/ 到独立临时目录，从该目录运行 bash deploy/update.sh。已有 robot-lab 容器时使用更新脚本；install.sh仅用于首次部署。

- 容器 robot-lab 将主机3001映射到Nginx的80端口。
- 发布目录为 /opt/robot-lab/releases/<build-id>/，current符号链接指向当前版本。
- update.sh验证现有容器与Nginx配置，建立新发布目录，再原子切换current。
- 为兼容仍打开的旧页面，保留旧哈希静态资源；旧发布目录也保留用于回滚。
- HTTP构建ID检查失败时自动恢复原current。

更新后执行 node deploy/verify-release.mjs 校验5个入口及JS/CSS哈希，并执行 node scripts/verify-single-map-browser.mjs http://121.199.30.133:3001/ 做公网浏览器验收。线上测试只在浏览器独立配置中保存成绩。

首次部署：在上传目录运行 bash deploy/install.sh。脚本要求root和空闲3001端口，会创建Nginx容器及防火墙规则。Nginx配置见 nginx.conf。

手动回滚：按 DEPLOYED.md 中记录的旧发布路径创建临时符号链接，并用 mv -Tf 替换 /opt/robot-lab/current。切换后再次检查HTTP构建ID。

