# 发布游戏与独立排行榜

规则 `single-map-v3`。游戏根地址、`index.html`、`preview.html` 使用同一地图；`leaderboard.html` 为独立榜单，游戏无入口。实际构建及回滚见 `DEPLOYED.md`。

先运行 README/TESTING 列出的构建与全部验证。发布前验收登录后的图文教学及网址限定测试模式。发布前用安全随机值生成至少16字符管理密码，保存于忽略的 `deploy/.leaderboard-admin-password.txt`。首次部署会安装至服务器私有目录；后续发布保留既有密码，不重新生成覆盖。

上传已验证的 `dist/`、`dist-server/`、`deploy/update.sh`、`deploy/nginx.conf`，首次新增API时还需安全传输密码文件，放入独立临时上传目录。从该目录运行 `bash deploy/update.sh`。`install.sh` 只负责首次安装入口，内部共用更新脚本。

- Nginx沿用 `robot-lab` 容器和主机3001端口。
- 静态文件：`/opt/robot-lab/releases/<build-id>/`，`current` 原子切换。
- API程序：`/opt/robot-lab/services/<build-id>/server.mjs`，不在公开静态目录；Node22容器 `robot-lab-api-<build-id>` 无外部端口，经私有Docker网络由Nginx代理 `/api/`。
- 成绩：`/opt/robot-lab/data/leaderboard.json`，写入后备份 `.bak`；发布/回滚保留数据。`ROBOT_DATA_DIR` 指向此目录。
- 管理密码：`/opt/robot-lab/secrets/admin-password`，目录700、文件600；`ROBOT_ADMIN_PASSWORD_FILE` 指向只读挂载。不得提交密码、成绩数据或上传包至公开仓库。
- 新旧API仅允许一个写入者；更新时先停止旧API，再启动新API读取既有数据。短暂不可用时游戏会暂存待上传成绩。
- 脚本备份原Nginx配置并原位写入，保留已有绑定挂载；自动检查API、Nginx及页面，失败恢复旧配置、旧静态版本和旧API。旧API停止保留用于回滚。
- 保留旧哈希资源，兼容仍打开的页面；服务器不自动清理旧发布。

发布后执行 `node deploy/verify-release.mjs` 和 `node scripts/verify-single-map-browser.mjs http://121.199.30.133:3001/`。公网驾驶会提交专用QA昵称成绩，验收后管理员只删除该测试纪录。

管理入口：直接访问 `http://121.199.30.133:3001/leaderboard.html`，点击管理并输入本地密码文件的值。支持手动添加昵称与成绩、修改昵称/分数及删除；管理员成绩不受游戏0–5000范围限制，可输入正负整数（须在JavaScript安全整数范围内）。重复昵称提示使用修改功能；多人同时修改会提示刷新。密码可通过原位修改服务器私有文件后重启当前API来轮换，重启会使既有管理会话失效。

手动回滚须同时恢复静态、Nginx配置和对应API，确保只运行一个写入者，具体目标见 `DEPLOYED.md`。不要回滚或删除持久化成绩；规则变更需显式迁移，API不会静默抹除不兼容数据。
