# 共用图标透明背景

2026-11-17：学生端的导航、照顾操作、星贝、家长入口，以及学生端、家长端、管理端和登录页的品牌图标统一使用透明图集。

- 原图参考：`web/public/ui/island-icons-v1.png`，RGB 白底，保留用于追溯。
- 当前运行素材：`web/public/ui/island-icons-v2.png`，RGBA PNG，包含真实透明通道。
- 消费入口：`web/src/v2/IslandIcon.tsx`、`web/src/v2/island-icons.css`。
- 图集顺序：小岛、计划、旅行、挑战 / 材料、心愿、背包、家长 / 退出、喂食、陪玩、摸摸 / 抱抱、洗澡、小憩、星贝。

使用内置 imagegen 编辑原图，完成背景提取与边缘清理。透明版本直接接入共用组件，移除 `mix-blend-mode: multiply`，让米白细节、泡泡和图标颜色正常显示。图标外围留白使用透明像素，不依赖页面底色。保留任务卡片、按钮和选中状态的容器配色。

后台 Chromium 核验了米色、绿色、深色三种底色，以及登录页、学生桌面端、390px 手机端、家长端和管理端。各端均加载新图集，使用正常合成，无横向溢出。另通过项目类型检查、隔离验收和生产构建。

## 图像编辑提示词

背景提取（以 v1 图集为编辑目标，开启透明输出）：

> Edit the reference image by removing the white background from this 4×4 sprite sheet, with actual transparent alpha. Preserve exactly all 16 icon artworks, their colors, cream/white interior details, layout, grid order, sizes, framing and centers. No redesign or additions. Remove white background between separate icon parts as well. Clean antialiased edges, no white halo or rectangular patches. Keep a square canvas with equal 4×4 cells for the existing CSS sprite positions. Transparent PNG output.

边缘清理（以首次透明结果为编辑目标，保留透明输出）：

> Clean up this transparent PNG icon sprite sheet. There are unwanted yellow/green/orange speckles, dirty tiny pixel fragments, ragged pale white fringes and debris around the edges of the icons and scattered through the transparent gaps. Remove ALL that background-removal debris and white halos. Keep ONLY the sixteen smooth clay icon objects with clean natural antialiased boundaries. Preserve the sixteen artworks exactly, their white/cream interior details, all detached intended elements (stars, bubbles, heart rays), the square canvas and same 4×4 grid positions, size, framing and order. No redesign, no new art, no changing icon colors. All empty space around and between the icons should be perfectly alpha transparent, without colored speckles. Transparent PNG with clean alpha.
