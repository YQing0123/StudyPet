# 伴学小岛 · 飞牛 NAS Docker 部署准备

检查日期：2026-11-14（Asia/Shanghai）。目标 NAS：`192.168.13.142`，管理入口 `https://192.168.13.142:5667/`。

当前 NAS 发布为 `2026.11.14-ipad1`，正式入口为 `https://studypet.iepose.cn`，实际版本可通过 `/release.json` 查询。iPad动作兼容修复见第10节；此前源码时点补发见第9节。穿透链路为外网 HTTPS → `http://192.168.13.142:7788` → 容器 7717。

首次部署按“先看看效果”使用独立数据目录，没有迁移本机家庭、孩子、宠物和推送凭据；后续更新继续挂载该 NAS 数据目录，已有账号直接登录。下文第 1～8 节保留首次部署调查与历史记录，后续版本以第 9 节为准。

## 1. 部署前 NAS 已核实的信息

| 项目 | 结果 |
| --- | --- |
| 主机名 / 系统 | NasforYQ / fnOS 1.2.1010（Mainland-PE） |
| CPU / 架构 | Intel Celeron J3160，4 核 4 线程；目标镜像用 `linux/amd64` |
| 内存 | 8 GiB；前一次系统查询可用约 4.94 GiB，实际部署前重新确认 |
| 数据存储 | `/vol1`，Btrfs；前一次查询剩余约 670.98 GiB |
| Docker 可用性 | `available=true`，`dockerStarted=true` |
| Docker 引擎数据目录 | `/vol1/docker`，这是 Docker 自身的目录，不作为本项目业务数据目录 |
| 镜像清单 | 返回 8 个镜像，包括 postgres:16-alpine、hanxi/xiaomusic、cloudflared 等；没有本项目镜像 |
| 网络 | `bridge`（172.17.0.0/16）、`trim-default`（172.18.0.0/16）、`host`、`none` |
| Compose 清单 | xiaomusic=`created`；xunlei=`failed` 且 `Orphaned=true` |
| 容器列表 | 普通列表及 `--all` 均只返回 `result=succ`、`rev=0.9.30`，缺少资源列表；容器数量、名称和端口占用尚不能完整确认 |
| 聚合统计 | 返回 `none` 项，CPU/内存/网络均为 0；该结果不能替代完整容器清单 |
| TCP 探测 | 22 可连接；7717、7788、8080 当时连接被拒绝，7788 可作为候选端口，启动时仍需核实冲突 |

部署前查询使用已授权的 fnos-cli，当时未修改 NAS 容器。现有 Compose 的异常状态仅作记录，不能据此判断具体故障原因。本次后续操作仅新增本项目镜像、目录、网络及容器，未处理 xiaomusic、xunlei 等已有项目。

Docker Engine 和 Compose 的具体版本未由当前查询接口返回。后续有 NAS shell 执行通道时，在 NAS 上运行：

```sh
docker version
docker compose version
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker info --format '{{.Architecture}} {{.DockerRootDir}}'
id
```

22 端口可连接仅代表 SSH 服务有响应，并不代表已获得 shell 登录凭据。无需为部署开放未认证的 Docker TCP API。

## 2. 项目真实运行需求

| 项目 | 当前实现 / 部署选择 |
| --- | --- |
| 前端 | React 19 + Vite 6 + TypeScript；构建输出 `web/dist` |
| 后端 | Node.js 原生 HTTP 服务，`server/index.mjs` |
| Node 版本 | 使用内置 `node:sqlite`，不能按普通 Node 18/20 项目部署；镜像采用 Node.js 24 |
| 生产启动 | `node server/index.mjs --static`，同一服务托管前端、API 和宠物视频 |
| 内部端口 | 7717；`HOST=0.0.0.0`，使 Docker 端口映射可访问 |
| 数据库 | SQLite，`banxue.db`，WAL 模式；无需 PostgreSQL、Redis |
| 持久化 | `BANXUE_DATA_DIR=/data`；挂载整个目录，包含数据库、WAL/SHM 和 media 子目录 |
| 运行时素材 | 已生成的 PNG/WebM 等随静态构建进入镜像，不需要在 NAS 运行生图、RIFE 或 Python 素材脚本 |
| 旧音频模块 | 源码有 ffmpeg/ffprobe 调用，当前教材/音频导入接口已停用；本次 MVP 镜像不装 ffmpeg，未来重开导入功能时再补齐并验证 |
| 健康检查 | `GET /api/health`，镜像使用 Node fetch 检查，无需额外安装 curl |
| 通知 | 可选出站 HTTPS：钉钉、企业微信、PushPlus；密钥由现有数据库保存，不写入镜像或本部署文档 |

体积参考：检查时 `web/public` 约 129 MiB、已有 `web/dist` 约 149 MiB、本机 `data` 约 9.1 MiB。这些是文件体积，不是容器实际内存需求。

## 3. 已准备的文件与默认参数

- `app/Dockerfile`：多阶段构建，Node 24，pnpm 10.11.0 + frozen lockfile，最终镜像以非 root 用户运行。
- `app/.dockerignore`：仅允许构建必需的配置、server 和 web 进入构建上下文；本机数据库、备份、`.env`、输出与 node_modules 不进入镜像。
- `app/compose.yaml`：amd64、自动重启、健康检查、独立 bridge 网络、只读根文件系统、可写数据目录与 `/tmp`、日志轮转。
- `app/.env.nas.example`：NAS 参数模板，正式执行时复制为 `.env`。
- `server/index.mjs`：新增 `HOST` 环境变量，本机默认仍为 127.0.0.1。

| 参数 | 初始方案 |
| --- | --- |
| 项目名称 / 镜像 | banxue-island / `banxue-island:0.1.0` |
| 正式访问入口 | `https://studypet.iepose.cn`，已部署并验证首页与健康接口 |
| 内网转发目标 | `http://192.168.13.142:7788`，供穿透服务访问及健康检查 |
| 端口映射 | NAS 7788 → 容器 7717 |
| 应用数据路径 | `/vol1/1000/banxue-island/data`（已创建并挂载，首次启动初始化独立数据库） |
| 数据备份路径 | `/vol1/1000/banxue-island/backups`（已创建；尚未配置定时备份） |
| 用户 UID/GID | 默认 1000:1000；需以 NAS 目录实际所有权和 ACL 为准，可通过环境变量修改 |
| 内存 / CPU 限额 | 768 MiB / 1.5 核，为家庭试运行的初始上限，需按实际占用调整 |
| 副本数 | 1；SQLite 使用本机 Btrfs 目录，不放到 SMB/NFS 挂载，不做多副本写入 |
| 公网 Origin | `BANXUE_PUBLIC_ORIGIN=https://studypet.iepose.cn`，已写入 `.env.nas.example` |

`BANXUE_PUBLIC_ORIGIN` 设为 HTTPS 后，会话 Cookie 将带 Secure。此时应从对应 HTTPS 地址登录，不再用 HTTP 地址验证登录。家长设置中的孩子级外部地址优先于该默认值，迁移时也要检查已有设置。

## 4. 推荐执行方式：Mac 构建 amd64 镜像，NAS 导入

NAS 是低功耗 J3160，建议在 Mac 上完成构建，并导出镜像，减少 NAS 构建负担和对镜像仓库网络的依赖。Mac 自身为 arm64，必须保留 `--platform linux/amd64`。

在本机 `app/` 目录执行：

```sh
docker buildx build --platform linux/amd64 --load -t banxue-island:0.1.0 .
mkdir -p ../output/nas-docker-20261114
docker save banxue-island:0.1.0 | gzip > ../output/nas-docker-20261114/banxue-island-0.1.0-linux-amd64.tar.gz
```

将镜像包、`compose.yaml` 和 `.env.nas.example` 传到 NAS 项目目录。仅复制镜像时，不需要上传 node_modules、原始素材工程和本机数据库。

NAS 上的后续命令示例（先核实目录与 UID/GID，不在本轮自动执行）：

```sh
cd /vol1/1000/banxue-island
cp .env.nas.example .env
mkdir -p data backups
# 确认运行用户实际有 data 的写权限；按真实 UID/GID 修正目录所有权和 ACL。
docker load -i banxue-island-0.1.0-linux-amd64.tar.gz
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --no-build --pull never
docker compose ps
docker compose logs --tail=100 app
curl --fail http://127.0.0.1:7788/api/health
```

`compose.yaml` 保留了 build 配置用于源码部署；镜像导入方式明确使用 `--no-build --pull never`。使用 fnOS 图形界面导入 Compose 时，要核实其是否读取同目录 `.env` 及实际解析出的挂载路径，不能只看“创建成功”。

若选择在 NAS 源码构建，则上传 app 的构建必需文件，执行 `docker compose up -d --build`。这种方式仍需 NAS 能访问基础镜像仓库和 npm registry；本轮未在 NAS 拉取或构建来验证网络。

## 5. 现有家庭数据迁移

首次部署可用空 data 创建新家庭；如需保留当前家庭、宠物、计划、照片和推送设置，应先迁移真实数据，再启动 NAS 服务。不能让新建空库覆盖旧库。

SQLite 正在使用 WAL：**不能直接复制单独的活动 `banxue.db` 文件**，否则可能漏掉 WAL 中的已提交数据。迁移步骤：

1. 确定切换时间，停止本机开发 API、静态预览等所有写入该数据库的服务，避免切换后的两份数据继续各自增长。
2. 使用 SQLite `.backup` 生成一致快照；将 `media/` 一起复制。不要把旧的 `banxue.db-wal` 或 `banxue.db-shm` 附到新快照。
3. 传入 NAS 的 data，确认目录与数据库文件可由容器运行用户读写；保留原数据及单独快照。
4. 启动 NAS，检查原账号登录、孩子、宠物、计划、照片和通知配置。启用真实推送及发送测试消息应由用户另行决定。
5. 完成切换后只在 NAS 写入；本机继续开发改用隔离数据目录。

一致快照示例，在本机 app 目录执行；目标目录必须是新的，确认服务已停止写入：

```sh
mkdir -p ../output/nas-migration-snapshot
sqlite3 data/banxue.db ".backup '../output/nas-migration-snapshot/banxue.db'"
cp -R data/media ../output/nas-migration-snapshot/media
sqlite3 ../output/nas-migration-snapshot/banxue.db 'PRAGMA integrity_check;'
```

整库包含密码摘要、家庭资料、孩子作业照片、持久会话和推送凭据，按家庭数据管理；不进入镜像、代码仓库或公开分享。运行中的定期备份同样使用 SQLite backup；全目录冷备须先停容器。宠物备份功能只备份宠物状态，不能替代数据库与 media 的整站备份。

更新前保留旧镜像标签和数据库快照。数据库在启动时执行增量迁移，遇到 schema 不兼容时，回滚需要配套恢复对应版本的数据快照，不能仅切回旧镜像。

## 6. 联网及对外访问

内网试运行只需 7788 一个业务端口，NAS 的 5667 是管理端口。前端和 `/api` 保持同源，不需要部署开发 Vite 服务或单独暴露数据库端口。

用户已提供内网穿透配置：网页服务 `StudyPet`，转发设备 NasforYQ，外部 `https://studypet.iepose.cn`，内部 `http://192.168.13.142:7788`，访问方式为公开访问，内网重定向关闭。该方式允许家长手机与钉钉获取限时图片链接，应用本身继续使用现有家庭账号体系验证业务访问。

穿透应转发整个站点，包括 `/api`、`/api/notify-images/`、`/assets/`、`/pets/`，保留 Host，并支持视频 Range 请求。公网 HTTPS 在穿透入口终止，内部转发 HTTP；应用使用已配置的 `BANXUE_PUBLIC_ORIGIN` 生成 Secure Cookie。NAS 管理端口 5667 不用于本应用访问。

部署前探测曾返回外网 404、内网 7788 连接被拒绝。容器启动后已复核：内外网 `/api/health` 返回 `{"ok":true,...}`，外网首页与匿名会话接口返回 200，宠物视频 Range 返回 206。钉钉真实图文投递仍需用户在新家庭中配置并启用真实推送通道后验证。

默认外部地址由环境变量提供；如迁移的数据库中已经为某个孩子单独保存外部访问地址，该设置优先，须在家长设置中核对为 `https://studypet.iepose.cn`。本次未修改真实数据库中的地址和通知配置。

## 7. 验证记录

- Compose 参数模板解析：通过 `docker compose --env-file .env.nas.example config --quiet`。
- `HOST=0.0.0.0` 本地隔离数据启动：健康接口、匿名会话接口、静态首页均返回 200；宠物视频 Range 请求返回 206 且字节数正确。
- `npm run typecheck`：通过。
- `TEST_PORT=18737 npm test`：全部 12 个隔离验收脚本通过，包括账号/家庭、计划审核、通知、卡片、备份、成长数值与品种素材检查；没有对真实家庭数据执行验收。
- Linux amd64 生产镜像：已在本机 Colima 构建并加载，Node.js 实际版本 v24.22.3。
- Compose 容器实跑：8 项检查通过，包含健康状态、非 root UID/GID、空挂载不带本机家庭数据、首页、视频 Range、SQLite 注册写入、容器重启后账号与会话保留、只读根目录与资源限额、镜像平台。验证时使用本机用户 UID/GID 与一次性数据目录；测试容器与目录已清理。
- 权限修正：镜像构建统一程序及静态素材的读取权限，避免 Mac 源文件的 600 权限导致自定义 NAS UID/GID 无法读取；运行时保持非 root。
- 已导出 [amd64 离线镜像包](../../output/nas-docker-20261114/banxue-island-0.1.0-linux-amd64.tar.gz)，约 228.3 MiB；已校验归档中的镜像标签、平台与启动命令。
- [SHA-256 校验文件](../../output/nas-docker-20261114/banxue-island-0.1.0-linux-amd64.tar.gz.sha256) 与 [容器验证记录](../../output/nas-docker-20261114/container-verification.json) 一并保存。上传后可在 NAS 运行 `sha256sum -c banxue-island-0.1.0-linux-amd64.tar.gz.sha256` 检查传输完整性。
- 本机镜像验证完成后，已执行 NAS 第一版部署，详情见下一节；真实家庭数据迁移未执行。

## 8. 第一版实际部署记录

部署时间：2026-11-14 19:56（Asia/Shanghai）。

| 项目 | 实际结果 |
| --- | --- |
| 正式入口 | `https://studypet.iepose.cn` |
| Compose 项目 | `banxue-island`，状态 `ready`，1/1 容器运行 |
| 容器 | `banxue-island-app-1`，状态 `running` / `healthy`，检查时重启次数为 0 |
| 镜像 | `banxue-island:0.1.0`，Linux amd64 |
| 镜像配置摘要 | `sha256:43450823622aaf19b305d58093b432919ed745be0eb2e1496a3b39993bd0e43b` |
| NAS Compose 文件 | `/vol1/1000/banxue-island/compose.yaml`，已展开全部参数且移除 build 配置，不依赖本机源码或 NAS 的 .env 解析行为 |
| 持久化 | `/vol1/1000/banxue-island/data` → `/data`，可写，运行 UID/GID=1000:1000 |
| 端口 | `0.0.0.0:7788` → `7717/tcp` |
| 限额与重启 | 768 MiB、1.5 CPU、`unless-stopped`；只读根文件系统与日志轮转已生效 |
| 数据 | 新库，无默认账号；本机数据与其他 NAS 服务未迁移、未覆盖 |

使用已授权的 fnos-cli 完成目录创建、文件上传、`imageLoad`、`composeCreate` 和 `composeBuild`。飞牛的 composeBuild 操作用已导入的本地镜像创建并启动容器，不是在 NAS 重新编译前端。首次对没有容器的项目直接调用 composeStart 返回未找到容器，随后通过 composeBuild 正常启动。

imageLoad 等长操作可能在 CLI 等待响应时超时，本次通过 image ls/inspect 确认导入结果后继续，没有重复导入。后续遇到类似情况应先读回状态，避免重复执行。

上线检查：

- 内网与外网健康接口均为 HTTP 200、`ok=true`。
- 外网匿名会话为 `authenticated=false`、`legacyAvailable=false`，确认是新站点；未登录读取学生业务接口返回 401。
- 外网宠物视频 Range 请求返回 206，32 字节范围与返回内容一致。
- 无头 Chrome 检查 1440×900 桌面与 390×844 手机登录入口，页面、文案及素材显示正常；浏览器控制台无错误。
- 未在公开实例中预设账号、提交作业、配置真实机器人或发送消息。账号创建与重启持久化此前已在本机同镜像的隔离环境验证。

实际发布配置：[release/compose.yaml](../../output/nas-docker-20261114/release/compose.yaml)。机器可读记录：[deployment-report.json](../../output/nas-docker-20261114/deployment-report.json)。截图位于 `output/playwright/nas-first-release-20261114/`。

## 9. 2026-11-14 最新源码补发

初次镜像在 18:39 构建，此后本机学生页（19:08）、播放器（19:18）及宠物素材（19:34）继续更新。19:56 首次上线使用了此前的镜像，未包含这些后续修改；当时仅检查服务可用，没有在发布前再次核对源码快照。

补发版本 `2026.11.14-2027` 从当前源码创建独立构建快照，共 656 个文件；构建后逐一核对镜像内 602 个后端与 public 文件，无内容差异。源码快照摘要为 `9b73661366becf3e6ee7b394a8acc92bfe38758052fb03b34a85ec92b68462ac`。构建时通过 `RELEASE_ID` 和 `SOURCE_SHA` 参数写入镜像标签与 `web/dist/release.json`，使用独立镜像标签，不覆盖 `0.1.0`。

- 镜像：`banxue-island:2026.11.14-2027`，linux/amd64；NAS 镜像配置摘要 `sha256:a86af619e0cbd5fe1fd2d5d52c2e1973bb3e565ae2a4fe8a5cf33e1b9177fcc8`。
- 更新前短暂停止服务，完整复制数据目录（含 SQLite WAL/SHM 与 media），另用 SQLite backup 生成一致性快照并通过 `PRAGMA integrity_check`。备份路径：`/vol1/1000/banxue-island/backups/before-2026.11.14-2027`。
- Compose 仍使用 `/vol1/1000/banxue-island/data`，保留 NAS 账号、家庭与业务数据；不重新初始化，不复制本机开发数据。
- 当前类型检查与全部 12 个隔离验收脚本通过；同镜像临时容器中验证账号创建、领养水豚、学生页桌面及手机显示，浏览器无错误。正式站点不创建验收账号。
- 对 NAS 实际返回的全部 593 个静态文件逐一比较 SHA-256，与新镜像完全一致。公网另核对前端脚本、样式、素材清单及水豚各成长阶段动作；后台浏览器确认公网加载新脚本与新版本。

构建快照、逐文件清单、实际 Compose 与机器可读验收记录位于 [nas-update-20261114-2027](../../output/nas-update-20261114-2027/)。后续发布应固定源码快照、使用独立标签，更新后比较 `/release.json`、前端 bundle 与素材哈希；服务可访问不能替代版本一致性检查。


## 10. 2026-11-14 iPad动作兼容发布

- 版本/镜像：`2026.11.14-ipad1` / `banxue-island:2026.11.14-ipad1`，linux/amd64。
- 固定源码摘要：`8c6965dc9b74e33e38452269cefa6b9b25e56e05f778f3688d2c7f14e4a55f54`；镜像构建自 `output/ipad-pet-animation-20261114/release-context`，包含本次18品种H.264/透明蒙版动作。构建期间工作区新增羊驼，未纳入该镜像，后续发布应另外验收。
- 正式容器：`8645074b7a6771b9c3b33c4828348a296ebf01cecedd1aa125fc41f62350b376`，healthy，重启0次。Compose及数据挂载延续原配置。
- 更新前停止本项目容器，完整复制data与compose至 `/vol1/1000/banxue-island/backups/before-2026.11.14-ipad1`；冷备目录条目尺寸一致，独立检查容器执行SQLite integrity_check并生成600权限的`banxue-consistent.sqlite`，检查后已清理。
- 镜像940个后端/public文件与固定源码逐一匹配；同镜像临时容器的iPad横竖屏生产UI检查通过17项。上线后931个静态文件逐一比对，公网HTML/bundle/manifest/透明蒙版/绿幕/蓝幕8文件与镜像相同，MP4 Range206通过。正式站点未建立测试账号或写入测试业务数据。
- fnos-cli的imageLoad请求曾因等待代理响应失败，但只读image inspect确认镜像已成功导入，未重复提交。首次备份辅助容器因CLI拆分`node -e`含空格参数失败，已改为上传独立脚本执行，完整性检查通过；失败及成功辅助容器均已清理。没有修改NAS其他服务。

iPad刷新站点后加载新脚本。WebKit后台模拟通过；用户真机复测仍待反馈。部署及完整机器可读证据位于 `output/ipad-pet-animation-20261114/`。
