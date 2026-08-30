# Ravel 桌面端 UI/UX 全面优化 + 功能补充实施计划

## Summary

Ravel 桌面端当前采用 **新 Shell 架构**（`RavelShell`），包含 ShellHeader（标题栏+surface切换+代理控制）、ShellRail（左侧活动栏）和三个 Surface（Chat/IDE/Histos）。当前主题为"Amber Workshop"琥珀色风格，右侧面板（Diff/Worktree/Snapshots 等 7 个功能面板）虽已实现但**仅存在于旧 Workbench 架构中，未接入新 Shell**。

本计划将分四个阶段推进：
1. **Design Tokens 重制** — 切换到蓝色系柔和风格，重建颜色/排版/间距/圆角/阴影/动效 token
2. **核心布局与组件视觉刷新** — 三 surface、标题栏、侧边栏、按钮、输入框等全面视觉升级
3. **功能补充** — 右侧面板接入新 Shell、模型中心/信任中心入口优化、IDE 底部面板完善
4. **交互体验优化** — 动效、状态反馈、空状态、错误状态统一

设计方向：参考 Codex 桌面端，整体柔和圆润、有动态感。
- 浅色模式背景：`#F0EEE9`，主题色：`#89ABE3`
- 深色模式背景：`#4E4B48`，主题色：`#0F4C81`

---

## Current State Analysis（现状分析）

### 1. 架构现状

| 层级 | 组件 | 状态 | 文件路径 |
|------|------|------|----------|
| 应用根 | `App.tsx` → `RavelShell` | ✅ 在用 | `src/renderer/App.tsx` |
| 应用壳 | `RavelShell` | ✅ 在用（新架构） | `src/renderer/shell/RavelShell.tsx` |
| 标题栏 | `ShellHeader` | ✅ 在用 | `src/renderer/shell/ShellHeader.tsx` |
| 左侧栏 | `ShellRail` | ✅ 在用（3个图标） | `src/renderer/shell/ShellRail.tsx` |
| Surface 路由 | `SurfaceRouter` | ✅ 在用 | `src/renderer/app/SurfaceRouter.tsx` |
| 旧 Workbench | `Workbench.tsx` | ❌ 已废弃（未被引用） | `src/renderer/components/layout/Workbench.tsx` |
| 旧 RightPanel | `RightPanel.tsx` | ❌ 仅旧架构使用 | `src/renderer/components/layout/RightPanel.tsx` |

### 2. 主题系统现状

- **颜色系统**：CSS 变量定义在 `global.css` 的 `:root`（浅色）和 `html.dark`（深色），共 60+ 个 token
- **当前风格**："Amber Workshop" — 琥珀色强调（`#b45309` 浅色 / `#e8b44a` 深色）
- **浅色背景**：纯白 `#ffffff` + 米色 `#fafaf9`
- **深色背景**：深棕 `#17150f` + `#1e1b13`
- **TS 侧**：`theme/tokens.ts` 定义 `Palette` 接口和 `motion` 对象，CSS 是唯一真源
- **Tailwind**：`tailwind.config.ts` 指向 CSS 变量，使用 Tailwind 4

### 3. 组件库现状

自建 UI 组件库位于 `src/renderer/ui/`，基于 `@base-ui/react`（Dialog）+ 纯 CSS：
- `Button` / `IconButton` — 3 种 variant（solid/quiet/outline），3 种 size
- `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` — 自定义实现
- `Dialog` — 基于 `@base-ui/react/dialog`
- `TextField` — 支持 label/hint/error/multiline/select
- `Switch` / `Tooltip` / `Popover` / `Menu`
- 样式全部在 `global.css` 中以 `.omega-*` 前缀定义

### 4. 右侧面板功能现状

所有 7 个面板都已实现，但**仅在旧 Workbench 中接入**：

| 面板 | 组件 | 状态 |
|------|------|------|
| Diff | `DiffViewer` | ✅ 完整实现（staged/unstaged、hunk 级选择） |
| Graph | `GraphPanel` | ✅ 已实现 |
| Worktree | `WorktreePanel` | ✅ 完整实现（创建/删除） |
| Agent | `AgentPanel` | ✅ 已实现 |
| Telemetry | `TelemetryPanel` | ✅ 已实现 |
| Snapshots | `SnapshotsPanel` | ✅ 完整实现（创建/恢复） |
| Terminal | `TerminalPanel` | ✅ 已实现 |

### 5. 模型中心 / 信任中心 / 资源中心

| 中心 | 组件 | 入口 | 状态 |
|------|------|------|------|
| 模型中心 | `ModelCenter` | ShellHeader → 更多菜单 | ✅ Dialog 形式，功能完整 |
| 信任中心 | `TrustCenter` | 设置弹窗 → 桌面 tab → 按钮 | ⚠️ 代码压缩严重，可读性差 |
| 资源中心 | `ResourceCenter` | ShellHeader → 更多菜单 | ✅ Dialog 形式，功能丰富（扩展/skills/prompts/MCP） |

### 6. 设置弹窗

- 3 个 tab：Agent / 桌面与快捷键 / 工作区资源
- 包含：权限配置、模式配置、快捷键、语言、worker 设置、资源浏览
- 模型中心/资源中心/信任中心通过按钮从设置中打开

### 7. 三个 Surface 布局

**ChatSurface**：
- 左：`SessionSidebar`（会话列表）
- 中：`ChatPanel`（消息流 + Composer）
- 右：`ContextDrawer`（上下文占用/Git/权限/连接状态）

**IdeSurface**：
- 左：`ChatPanel`（对话栏）
- 中：`EditorTabs` + `EditorGroup` + `BottomPanel`
- 右：`WorkspaceTree`（工作区目录树）

**HistosSurface**：
- 左：`ChatPanel`（对话栏）
- 右：`HistosToolbar` + `HistosGraphWorkspace` + `HistosInspector` + `HistosFlowDrawer`

---

## Proposed Changes（按优先级排列）

### Phase 1: Design Tokens 重制

**目标**：将琥珀色风格切换为柔和蓝色系风格，同时建立更完善的 token 体系。

#### 1.1 颜色系统重制

**改动文件**：
- `src/renderer/styles/global.css` — `:root` 和 `html.dark` 块
- `src/renderer/theme/tokens.ts` — `Palette` 类型定义（如需新增字段）
- `tailwind.config.ts` — 同步新增的 tailwind 颜色映射

**改动内容**：

浅色模式（主背景 `#F0EEE9`，主题色 `#89ABE3`）：
```
--ravel-bg: #F0EEE9              ← 主背景（暖灰白色）
--ravel-bg-rail: #E8E6E1         ← 侧边栏背景
--ravel-bg-panel: #F7F6F2        ← 面板背景
--ravel-bg-soft: #EFEDE8         ← 柔和背景
--ravel-bg-elevated: #FFFFFF     ← 浮层面板
--ravel-bg-overlay: #FFFFFF      ← 弹窗背景
--ravel-bg-code: #E8E6E1         ← 代码块背景

--ravel-accent: #89ABE3          ← 主题色（柔和蓝）
--ravel-accent-strong: #6B8FD4   ← 深主题色
--ravel-accent-soft: rgba(137, 171, 227, 0.15)
--ravel-accent-line: rgba(137, 171, 227, 0.40)
--ravel-accent-foreground: #FFFFFF
--ravel-accent-gradient: linear-gradient(135deg, #89ABE3 0%, #A8C4EE 100%)
--ravel-selected: rgba(137, 171, 227, 0.12)

--ravel-text: #2C3E50            ← 主文字（深蓝灰）
--ravel-text-soft: #3D5166
--ravel-text-muted: #6B7C8F
--ravel-text-dim: #94A3B4

--ravel-border: #D8D6D0
--ravel-border-strong: #C5C3BC
```

深色模式（主背景 `#4E4B48`，主题色 `#0F4C81`）：
```
--ravel-bg: #4E4B48              ← 主背景（深灰褐色）
--ravel-bg-rail: #45423F         ← 侧边栏背景
--ravel-bg-panel: #56534F        ← 面板背景
--ravel-bg-soft: #3D3B38         ← 柔和背景
--ravel-bg-elevated: #5E5B57     ← 浮层面板
--ravel-bg-overlay: #66635F      ← 弹窗背景

--ravel-accent: #0F4C81          ← 主题色（深蓝）
--ravel-accent-strong: #1A6BB0
--ravel-accent-soft: rgba(15, 76, 129, 0.25)
--ravel-accent-line: rgba(15, 76, 129, 0.50)
--ravel-accent-foreground: #E8F0F8
--ravel-accent-gradient: linear-gradient(135deg, #0F4C81 0%, #1A6BB0 100%)

--ravel-text: #E8E6E1
--ravel-text-soft: #D0CDC6
--ravel-text-muted: #A8A59E
--ravel-text-dim: #8C8983
```

**为什么**：
- 用户明确指定了新的配色方向（参考 Codex 风格：柔和、圆润、有动态感）
- 当前琥珀色与目标蓝色系风格差异较大，需要整体替换
- 保持 60+ 个 token 的完整性，确保所有语义颜色都有对应

**怎么改**：
1. 先更新 `global.css` 中 `:root` 块的所有颜色变量
2. 再更新 `html.dark` 块的所有颜色变量
3. 同步调整 semantic colors（success/warning/danger/info）的色调以适配新风格
4. 调整 glow/ambient 颜色为蓝色系
5. 更新 `tokens.ts` 中 `Palette` 接口如有新增字段
6. 验证 `tailwind.config.ts` 的颜色映射不需要改动（都指向 CSS 变量）

#### 1.2 排版系统增强

**改动文件**：
- `src/renderer/styles/global.css` — 新增排版 scale CSS 变量
- `src/renderer/theme/tokens.ts` — 新增 typography 相关导出

**改动内容**：
```
--ravel-font-size-xs: 0.6875rem   (11px)
--ravel-font-size-sm: 0.75rem     (12px)
--ravel-font-size-base: 0.875rem  (14px)
--ravel-font-size-md: 0.9375rem   (15px)
--ravel-font-size-lg: 1.0625rem   (17px)
--ravel-font-size-xl: 1.25rem     (20px)
--ravel-font-size-2xl: 1.5rem     (24px)

--ravel-line-height-tight: 1.25
--ravel-line-height-normal: 1.5
--ravel-line-height-relaxed: 1.7

--ravel-font-weight-regular: 400
--ravel-font-weight-medium: 500
--ravel-font-weight-semibold: 600
--ravel-font-weight-bold: 700
```

**为什么**：当前只有字体族定义，缺少统一的字号/行高/字重 scale，组件中硬编码 `0.8125rem` / `0.6875rem` 等数值。

#### 1.3 间距系统完善

**改动文件**：
- `src/renderer/styles/global.css` — 新增 spacing scale
- `tailwind.config.ts` — 同步 spacing 配置

**改动内容**：
```
--ravel-spacing-1: 4px
--ravel-spacing-2: 8px
--ravel-spacing-3: 12px
--ravel-spacing-4: 16px
--ravel-spacing-5: 20px
--ravel-spacing-6: 24px
--ravel-spacing-8: 32px
--ravel-spacing-10: 40px
--ravel-spacing-12: 48px
```

#### 1.4 圆角系统调整

**改动文件**：`src/renderer/styles/global.css`

**改动内容**：增大圆角以符合"柔和、圆润"的设计方向：
```
--ravel-radius-sm: 8px     ← 从 6px 增至 8px（控件）
--ravel-radius-md: 12px    ← 从 8px 增至 12px（卡片/按钮）
--ravel-radius-lg: 16px    ← 从 10px 增至 16px（面板/弹窗）
--ravel-radius-xl: 20px    ← 新增（大卡片）
--ravel-radius-pill: 999px （不变）
```

#### 1.5 阴影系统优化

**改动文件**：`src/renderer/styles/global.css`

**改动内容**：更柔和、多层次的阴影：
```
--ravel-shadow-sm: 0 1px 2px rgba(44, 62, 80, 0.06)
--ravel-shadow-md: 0 4px 16px rgba(44, 62, 80, 0.08), 0 1px 3px rgba(44, 62, 80, 0.04)
--ravel-shadow-lg: 0 20px 48px rgba(44, 62, 80, 0.12), 0 4px 12px rgba(44, 62, 80, 0.06)
--ravel-shadow-xl: 0 32px 64px rgba(44, 62, 80, 0.16), 0 8px 24px rgba(44, 62, 80, 0.08)
```

#### 1.6 动效 token 扩展

**改动文件**：
- `src/renderer/styles/global.css` — 新增动效变量
- `src/renderer/theme/tokens.ts` — 同步 `motion` 对象

**改动内容**：
```
--ravel-ease-out: cubic-bezier(0.22, 1, 0.36, 1)    （保持）
--ravel-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)  （新增）
--ravel-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1) （新增，弹性）

--ravel-dur-fast: 120ms    （保持）
--ravel-dur-normal: 200ms  （保持）
--ravel-dur-slow: 320ms    （保持）
--ravel-dur-slower: 480ms  （新增）
```

---

### Phase 2: 核心布局与组件视觉刷新

#### 2.1 ShellHeader 视觉升级

**改动文件**：
- `src/renderer/shell/ShellHeader.tsx`
- `src/renderer/styles/global.css` — `.ravel-titlebar-*` 相关样式

**改动内容**：
1. 高度从 44px 增至 48px，增加呼吸感
2. 标题栏背景改为 `bg-elevated` + 底部 1px 边框，增强层次感
3. 品牌标识（R 标记）改为圆角方形，带柔和阴影
4. Surface Tabs 分段控件视觉优化：
   - 更大的圆角（12px）
   - 选中态使用主题色渐变背景
   - 增加微互动（hover 轻微上浮）
5. 模型选择 pill 样式优化：更柔和的边框和背景
6. 状态 glyph（∞ 标记）颜色同步为新主题色
7. 窗口控件区域增加间距

#### 2.2 ShellRail 视觉升级

**改动文件**：
- `src/renderer/shell/ShellRail.tsx`
- `src/renderer/styles/global.css` — `.ravel-rail-*` 相关样式

**改动内容**：
1. 宽度从 48px 增至 52px
2. 背景色改为 `bg-rail`，右侧边框分隔
3. rail item 按钮：
   - 圆角从 md 增至 lg
   - 选中/hover 态使用 `accent-soft` 背景 + 主题色图标
   - 增加 2px 左侧指示条（选中态）
4. 底部 avatar 区域增加分隔线

#### 2.3 按钮组件全面刷新

**改动文件**：
- `src/renderer/styles/global.css` — `.omega-button-*` 所有样式
- `src/renderer/ui/Button.tsx` — 如有结构调整

**改动内容**：
1. **Solid 按钮**：
   - 背景：主题色渐变 → 更柔和的蓝调渐变
   - 圆角：从 8px 增至 12px
   - hover：亮度提升 + 轻微上浮 + 柔和阴影
   - active：轻微下压
2. **Outline 按钮**：
   - 边框更柔和
   - hover 态背景改为 `accent-soft`
3. **Quiet 按钮**：
   - hover 背景改为 `hover-fill`
4. **IconButton**：
   - 尺寸微调（32px sm / 36px md / 40px lg）
   - 圆角更圆
5. 统一按钮内边距和行高

#### 2.4 TextField / Select 组件刷新

**改动文件**：
- `src/renderer/styles/global.css` — `.omega-field` / `.omega-input` 样式
- `src/renderer/ui/TextField.tsx` — 如有结构调整

**改动内容**：
1. 输入框高度统一为 36px
2. 边框颜色更柔和，focus 态使用主题色光晕
3. 圆角从 6px 增至 10px
4. label 字体微调，增加与输入框的间距
5. hint/error 消息样式优化
6. select 下拉箭头样式优化

#### 2.5 Tabs 组件刷新

**改动文件**：
- `src/renderer/styles/global.css` — `.omega-tabs-*` / `.omega-tab-*` 样式
- `src/renderer/ui/Tabs.tsx` — 如有结构调整

**改动内容**：
1. TabsList 背景改为 `bg-soft`，圆角 12px，内边距 4px
2. TabsTrigger 圆角 8px，选中态使用 `bg-elevated` + 柔和阴影
3. 增加过渡动画（背景色、transform）
4. 文字颜色层级优化

#### 2.6 Dialog / 弹窗视觉刷新

**改动文件**：
- `src/renderer/styles/global.css` — `.omega-dialog-*` 所有样式
- `src/renderer/ui/Dialog.tsx` — 如有结构调整

**改动内容**：
1. 弹窗圆角从 10px 增至 16px
2. 阴影升级为 `shadow-xl`，更柔和
3. 背景增加 `inset-highlight` 顶部高光
4. 标题字体增大、字重调整
5. footer 区域增加上边框分隔
6. overlay 背景加深，增加模糊效果（backdrop-filter）

#### 2.7 Chat Surface 视觉优化

**改动文件**：
- `src/renderer/surfaces/chat/ChatSurface.tsx`
- `src/renderer/styles/global.css` — `.ravel-chat-*` 样式
- `src/renderer/components/chat/MessageBubble.tsx`
- `src/renderer/components/chat/Composer.tsx`

**改动内容**：
1. 会话侧栏：
   - 背景 `bg-rail`，右边框分隔
   - 会话项圆角增大，hover/active 态优化
2. 消息气泡：
   - 用户气泡：主题色渐变 + 圆角优化
   - AI 气泡：`bg-elevated` + 边框 + 柔和阴影
   - 气泡间距增大
3. Composer：
   - 背景 `composer-bg` + 顶部边框
   - 输入区域圆角增大，内边距优化
   - 发送按钮样式优化
4. 上下文抽屉：
   - 视觉风格与整体统一
   - 进度条样式优化

#### 2.8 IDE Surface 视觉优化

**改动文件**：
- `src/renderer/surfaces/ide/IdeSurface.tsx`
- `src/renderer/surfaces/ide/EditorTabs.tsx`
- `src/renderer/surfaces/ide/BottomPanel.tsx`
- `src/renderer/styles/global.css` — `.ravel-ide-*` 样式

**改动内容**：
1. 编辑器 tabs：
   - tab 圆角优化
   - 选中态底部指示条改为主题色
   - 关闭按钮 hover 态优化
2. 底部面板：
   - tab 样式与全局 Tabs 统一
   - 面板背景 `bg-panel`
3. 工作区目录树：
   - 背景 `bg-rail`
   - 文件/文件夹项 hover/active 态优化

#### 2.9 Histos Surface 视觉优化

**改动文件**：
- `src/renderer/surfaces/histos/HistosSurface.tsx`
- `src/renderer/surfaces/histos/HistosToolbar.tsx`
- `src/renderer/surfaces/histos/HistosFlowDrawer.tsx`
- `src/renderer/styles/global.css` — `.ravel-histos-*` 样式

**改动内容**：
1. 工具栏：
   - 背景 `bg-elevated`，底部边框
   - 按钮样式统一
   - lens 选择器样式优化
2. Flow Drawer：
   - 背景 `bg-panel`，左边框
   - 圆角优化
   - 按钮组样式统一

---

### Phase 3: 功能补充

#### 3.1 右侧面板接入新 Shell

**改动文件**：
- `src/renderer/shell/RavelShell.tsx` — 增加右栏布局
- `src/renderer/components/layout/RightPanel.tsx` — 复用并适配
- `src/renderer/store/slices/chromeSlice.ts` — LayoutState 保持不变
- `src/renderer/styles/global.css` — 新增 `.ravel-shell-right` 样式

**改动内容**：
1. 在 `RavelShell` 的主体布局中增加右侧面板列：
   - 布局结构：ShellRail (52px) | ShellLayout (flex) | RightPanel (可折叠)
   - 默认可折叠状态：显示 48px 图标 rail
   - 展开宽度：默认 380px，可拖拽调整（280px - 600px）
2. 复用 `RightPanel.tsx` 组件，做以下调整：
   - 样式类名从 `omega-rail` 改为 `ravel-*` 命名空间
   - Tabs 样式与新 UI 统一
   - 关闭按钮位置优化
3. 右侧图标 rail（折叠态）：
   - 7 个面板图标：Diff / Graph / Worktree / Agent / Telemetry / Snapshots / Terminal
   - 点击图标：展开面板并切换到对应 tab
   - tooltip 提示
4. 状态管理：
   - 复用现有的 `layout.rightPanelOpen` 和 `layout.rightTab`
   - 确保与 IDE surface 的底部面板不冲突（右侧面板是全局的，底部面板是 IDE 内部的）

**为什么**：
- 右侧面板的 7 个功能都已实现但未接入新 Shell
- 这是用户明确要求的"未部署功能"之一
- Codex 风格的三栏布局（左导航 + 中央内容 + 右辅助面板）是标准形态

**怎么改**：
1. 在 `RavelShell.tsx` 中引入右侧面板的状态和渲染逻辑
2. 参考旧 `Workbench.tsx` 的实现模式，但适配新 Shell 架构
3. 添加 `PanelResizeHandle` 支持宽度调整
4. 处理紧凑视口（<980px）下的抽屉模式
5. 确保 focus 模式下右侧面板也能隐藏

#### 3.2 模型中心入口优化

**改动文件**：
- `src/renderer/shell/ShellHeader.tsx`
- `src/renderer/components/layout/ModelCenter.tsx`

**改动内容**：
1. 在 ShellHeader 的模型选择 pill 上增加"打开模型中心"的入口（右侧增加一个图标按钮）
2. 模型中心 Dialog 视觉优化：
   - 左右两栏布局更清晰
   - 提供商卡片样式优化（圆角、阴影、hover 态）
   - 模型列表项样式优化
   - 搜索框样式统一
3. 增加"快速切换"入口：模型选择下拉框底部增加"打开模型中心"按钮

**为什么**：当前模型中心入口较深（更多菜单 → 模型中心），用户需要更便捷的访问方式。

#### 3.3 信任中心入口优化

**改动文件**：
- `src/renderer/components/layout/TrustCenter.tsx` — 代码格式化 + 优化
- `src/renderer/shell/ShellHeader.tsx` — 考虑添加入口
- `src/renderer/components/layout/SettingsDialog.tsx` — 优化入口按钮

**改动内容**：
1. 重构 `TrustCenter.tsx`：
   - 将压缩在一行的代码展开，提高可读性
   - 优化布局：每行项目的信息架构更清晰
   - 增加状态 chip 样式（trusted/untrusted/undecided 三种状态视觉区分更明显）
   - 下拉选择器样式优化
   - 增加继承信任的视觉提示
2. 在设置弹窗的"桌面"tab 中，将信任中心按钮移到更显眼的位置（权限 section 顶部）
3. 考虑在 ShellRail 或更多菜单中增加信任中心快捷入口

**为什么**：
- 当前信任中心代码可读性极差（整文件压缩在 18 行内）
- 入口较深，用户难以发现
- 项目信任是重要的安全功能，需要更突出的入口

#### 3.4 IDE Bottom Panel 完善

**改动文件**：
- `src/renderer/surfaces/ide/BottomPanel.tsx`
- `src/renderer/surfaces/ide/IdeSurface.tsx`

**改动内容**：
1. 确认 BottomPanel 当前包含哪些 tab（Terminal / Problem / Output 等）
2. 将右侧面板中的部分功能（如 Terminal）与 IDE 底部面板整合
3. 底部面板增加拖拽调整高度功能
4. 底部面板 tab 样式与全局 Tabs 统一

**为什么**：IDE 表面的底部面板是开发者常用功能区，需要确保功能完整且视觉统一。

---

### Phase 4: 交互体验优化

#### 4.1 动效统一

**改动文件**：
- `src/renderer/styles/global.css` — 统一所有 transition
- 各组件样式

**改动内容**：
1. 所有交互元素统一使用 `--ravel-ease-out` 缓动函数
2. 统一动画时长：
   - 微交互（hover/focus）：`--ravel-dur-fast` (120ms)
   - 状态切换（tabs/展开折叠）：`--ravel-dur-normal` (200ms)
   - 页面/面板切换：`--ravel-dur-slow` (320ms)
3. 增加弹性动效用于关键操作（如按钮点击反馈）
4. 确保所有动画遵循 `prefers-reduced-motion` 设置

#### 4.2 状态反馈优化

**改动文件**：
- 各组件文件
- `src/renderer/styles/global.css` — 新增状态样式

**改动内容**：
1. Loading 状态：
   - 统一 spinner 样式和尺寸
   - 按钮 loading 态优化（spinner + 文字变化）
   - 页面/面板 loading 增加骨架屏或 shimmer 效果
2. Success 状态：
   - 操作成功后增加 toast 通知（如"已保存"、"已删除"）
   - 成功状态视觉反馈（绿色 + ✓ 图标）
3. Error 状态：
   - 错误提示样式统一（红色边框 + 错误图标）
   - 错误信息更友好，提供重试选项
4. Empty 状态：
   - 各列表/面板的空状态统一设计（图标 + 文字 + 操作按钮）
   - 空状态插画风格统一

#### 4.3 滚动条美化

**改动文件**：`src/renderer/styles/global.css`

**改动内容**：
1. 滚动条宽度从 8px 减至 6px（更精致）
2. 滚动条圆角增大
3. hover 态颜色更明显
4. 滚动条轨道背景透明
5. 确保深色/浅色模式下滚动条颜色适配

#### 4.4 Tooltip 优化

**改动文件**：
- `src/renderer/ui/Tooltip.tsx`
- `src/renderer/styles/global.css` — tooltip 样式

**改动内容**：
1. Tooltip 背景改为半透明玻璃态（backdrop-filter blur）
2. 圆角增大至 8px
3. 内边距优化
4. 淡入淡出动画
5. 箭头样式优化

#### 4.5 主题切换动效优化

**改动文件**：
- `src/renderer/theme/palettes.ts` — `applyModeWithTransition` 函数
- `src/renderer/styles/global.css` — view-transition 相关样式

**改动内容**：
1. 确认当前的圆形揭示动画正常工作
2. 优化动画曲线和时长
3. 确保深色/浅色切换时所有元素平滑过渡
4. 减少动画过程中的闪烁

---

## Assumptions & Decisions（假设与决策）

### 关键假设

1. **新 Shell 架构是目标架构**：旧 Workbench 和旧 Header/TitleBar 是遗留代码，不会再使用。所有改动基于新 Shell 架构。
2. **不引入新 UI 框架**：保持 React + 自建 UI 组件（基于 @base-ui/react 的 Dialog）+ Tailwind CSS + 全局 CSS 的技术栈，不引入 shadcn/ui、MUI 等新框架。
3. **右侧面板是全局的**：右侧面板（Diff/Worktree/Snapshots 等）是全局层面的功能，在三个 Surface 中都可见，而不仅仅属于 IDE Surface。
4. **颜色替换是安全的**：所有颜色都通过 CSS 变量定义，替换 token 值不会破坏功能，只会改变视觉。
5. **用户提供的颜色是准确的**：
   - 浅色模式背景 `#F0EEE9`，主题色 `#89ABE3`
   - 深色模式背景 `#4E4B48`，主题色 `#0F4C81`

### 关键决策

1. **分阶段交付**：Phase 1（tokens）→ Phase 2（视觉）→ Phase 3（功能）→ Phase 4（体验）。前一阶段是后一阶段的基础。
2. **保持向后兼容**：所有状态管理（Zustand store）的接口保持不变，只改视觉和布局，不改数据结构。
3. **优先视觉提升，其次功能补充**：按用户要求，先做 tokens 和视觉刷新，再做功能接入。
4. **双模式全覆盖**：每一处改动都必须同时考虑浅色和深色模式，不能只做一个。
5. **复用现有组件**：右侧面板的 7 个功能面板（DiffViewer/WorktreePanel 等）直接复用，不重写，只做接入和样式适配。
6. **不删除旧代码**：旧 Workbench 等遗留代码先保留不动，待新功能稳定后再清理，降低风险。

### 风险点

1. **右侧面板与 IDE Surface 的关系**：IDE Surface 内部有自己的底部面板和右侧目录树，全局右侧面板的引入可能导致 IDE 界面过于拥挤。
   - **决策**：右侧面板是全局的，IDE 的目录树是 IDE 内部的。两者可以共存，用户可以按需展开/折叠。
2. **样式回归风险**：全局 CSS 改动可能影响到未被注意到的角落。
   - **缓解**：每个 phase 完成后进行全面的视觉走查。
3. **TrustCenter 代码质量**：该文件代码严重压缩，修改时容易出错。
   - **缓解**：第一步先格式化代码、理清结构，再做功能优化。

---

## Verification Steps（验证步骤）

### Phase 1 验证

1. **Token 完整性检查**：
   - 浅色模式：检查所有 `--ravel-*` 颜色变量在 `:root` 中有定义
   - 深色模式：检查所有 `--ravel-*` 颜色变量在 `html.dark` 中有定义
   - 确认没有硬编码的 hex 颜色值出现在组件中
2. **主题切换测试**：
   - 浅色 → 深色 → 系统模式 切换正常
   - 切换动画流畅，无闪烁
   - 所有 UI 元素颜色正确切换
3. **对比度检查**：
   - 正文文字与背景对比度 ≥ 4.5:1
   - 辅助文字与背景对比度 ≥ 3:1
   - 主题色按钮上的文字与背景对比度 ≥ 4.5:1

### Phase 2 验证

1. **组件视觉走查**：
   - 按钮：solid/outline/quiet 三种 variant，sm/md/lg 三种 size
   - 输入框：正常/focus/error/disabled 四种状态
   - Tabs：选中/未选中/hover 状态
   - Dialog：打开/关闭动画、标题、内容、footer
   - Tooltip：触发、显示、位置
2. **三个 Surface 布局验证**：
   - Chat Surface：会话列表、消息流、composer、上下文抽屉
   - IDE Surface：对话栏、编辑器 tabs、代码阅读区、底部面板、目录树
   - Histos Surface：对话栏、工具栏、图谱区、inspector、flow drawer
3. **响应式测试**：
   - 宽窗口（>1200px）布局正常
   - 中等窗口（980-1200px）布局正常
   - 紧凑窗口（<980px）抽屉模式正常
4. **深色/浅色双模式验证**：
   - 所有组件在两种模式下视觉正确
   - 无颜色冲突或可读性问题

### Phase 3 验证

1. **右侧面板功能验证**：
   - 展开/折叠正常
   - 宽度拖拽调整正常
   - 7 个 tab 切换正常：Diff / Graph / Worktree / Agent / Telemetry / Snapshots / Terminal
   - 每个面板的核心功能正常
   - 紧凑视口下抽屉模式正常
   - Focus 模式下隐藏正常
   - 三个 Surface 中右侧面板都正确显示
2. **模型中心入口验证**：
   - ShellHeader 新入口可正常打开模型中心
   - 模型中心 Dialog 功能正常
   - 提供商配置正常
   - 模型切换正常
3. **信任中心验证**：
   - 入口可正常打开
   - 工作区列表正确显示
   - 信任状态切换正常
   - 继承信任显示正确
4. **IDE 底部面板验证**：
   - 各 tab 切换正常
   - 高度拖拽调整正常
   - Terminal 功能正常

### Phase 4 验证

1. **动效一致性检查**：
   - 所有按钮 hover/active 动画一致
   - 所有展开/折叠动画一致
   - 所有页面切换动画一致
   - 遵循 `prefers-reduced-motion` 设置
2. **状态反馈验证**：
   - Loading 状态：spinner 正确显示，按钮禁用
   - Success 状态：操作后有明确的成功反馈
   - Error 状态：错误信息清晰，有重试选项
   - Empty 状态：各空状态有合适的提示和引导
3. **可访问性验证**：
   - 键盘导航正常（Tab / Enter / Escape）
   - 焦点指示器可见
   - ARIA 标签正确
   - 屏幕阅读器兼容性

### 整体验证

1. **回归测试**：
   - 核心工作流：新建会话、发送消息、工具调用、代码编辑
   - 三个 Surface 切换正常
   - 设置功能正常
   - 资源中心功能正常
2. **性能检查**：
   - 无明显的动画卡顿
   - 滚动流畅
   - 大对话列表性能可接受
3. **文件清单确认**：
   - 所有改动文件列表与计划一致
   - 无意外的文件修改

---

## 文件改动总览

| Phase | 文件 | 改动类型 |
|-------|------|----------|
| 1 | `src/renderer/styles/global.css` | 颜色/排版/间距/圆角/阴影/动效 token 重写 |
| 1 | `src/renderer/theme/tokens.ts` | Palette 类型扩展、motion 对象扩展 |
| 1 | `tailwind.config.ts` | 同步新增的 tailwind 配置 |
| 2 | `src/renderer/shell/ShellHeader.tsx` | 标题栏视觉升级 |
| 2 | `src/renderer/shell/ShellRail.tsx` | 侧边栏视觉升级 |
| 2 | `src/renderer/styles/global.css` | 按钮/输入框/Tabs/Dialog 等组件样式刷新 |
| 2 | `src/renderer/surfaces/chat/ChatSurface.tsx` + 相关组件 | Chat 表面视觉优化 |
| 2 | `src/renderer/surfaces/ide/IdeSurface.tsx` + 相关组件 | IDE 表面视觉优化 |
| 2 | `src/renderer/surfaces/histos/HistosSurface.tsx` + 相关组件 | Histos 表面视觉优化 |
| 3 | `src/renderer/shell/RavelShell.tsx` | 接入右侧面板 |
| 3 | `src/renderer/components/layout/RightPanel.tsx` | 样式适配新 Shell |
| 3 | `src/renderer/components/layout/ModelCenter.tsx` | 入口优化 + 视觉优化 |
| 3 | `src/renderer/components/layout/TrustCenter.tsx` | 代码重构 + 入口优化 + 视觉优化 |
| 3 | `src/renderer/shell/ShellHeader.tsx` | 新增模型中心快捷入口 |
| 3 | `src/renderer/surfaces/ide/BottomPanel.tsx` | 底部面板完善 |
| 4 | `src/renderer/styles/global.css` | 动效统一、滚动条、tooltip 优化 |
| 4 | 各组件文件 | 状态反馈、空状态、错误状态优化 |
