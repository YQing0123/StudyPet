# StudyPet · 伴学小岛

面向家庭的学习打卡与宠物养成应用。家长安排计划、审核打卡并设置学习挑战，孩子通过完成学习获得星贝，照顾宠物、收集旅行纪念品和布置自己的小岛。

项目包含学生端、家长端与独立管理端，使用 React、TypeScript、Vite、Node.js 和 SQLite，支持 Docker 部署。

## 主要功能

- 学习计划、拍照打卡、家长审核、日历统计和奖励兑换。
- 古诗词与数学计算挑战，可设置每日次数、每轮题量与时长；错题保留掌握历史，家长可分页查询和查看统计。
- 宠物成长、互动、清洁、装扮、定时睡眠与旅行收藏。
- 场景和家具兑换、自由布置、北京时间日夜场景切换。
- 多家庭、多孩子与独立学生账号，管理员管理家庭开通码和题库。
- 可配置消息推送、每日汇总与宠物备份恢复。

## 本地开发

建议使用 Node.js 24 和 pnpm 10。

```bash
cd app
pnpm install --frozen-lockfile
pnpm dev
```

开发页面默认位于 `http://127.0.0.1:5199/`，API 默认监听 `7717`。首次使用的账号、家庭开通及部署配置请参阅 [应用说明](app/README.md) 和 [家庭账号接入](app/docs/账号与家庭接入-2026-11-13.md)。仓库不包含预设可用密码或真实家庭数据。

```bash
cd app
pnpm typecheck
pnpm test
pnpm build
```

测试脚本使用临时数据库，不修改已有家庭记录。

## Docker

Apple Silicon Mac 的隔离测试环境使用 Colima：

```bash
cd app
sh scripts/local-docker.sh up -d --build --wait
```

访问 `http://127.0.0.1:7788/`，管理入口为 `/admin`。其他环境请按需调整 Compose 配置，详见 [本地 Docker 说明](app/docs/本地Docker测试环境.md) 和 [NAS 部署说明](app/docs/NAS-Docker部署准备-2026-11-14.md)。

## 项目目录

| 目录 | 内容 |
| --- | --- |
| `app/web/` | 页面、交互与运行时宠物和场景素材 |
| `app/server/` | API、账号权限、学习和宠物业务、SQLite 存储 |
| `app/scripts/` | 验证、素材处理和管理工具 |
| `app/assets/` | 宠物制作源素材 |
| `app/docs/` | 功能说明、验收和部署记录 |
| `design/`、`prototype/`、`方案/` | 设计资料、原型与产品方案 |

版本管理保留源码、运行所需素材、设计资料和文档；本机凭据、家庭数据库、备份、依赖和构建产物由 `.gitignore` 排除。详见 [版本管理说明](VERSION_CONTROL.md)。
