# Agent 工作台重新设计 - 设计文档

**日期**: 2026-06-12
**作者**: brainstorming + ui-ux-pro-max
**前置**:
- `2026-05-20-agent-frontend-ui-design.md`（原前端设计）
- `2026-06-01-langgraph-dual-workflow-event-rendering-design.md`（事件渲染协议）
- `2026-06-11-agent-runtime-refactor-design.md`（运行时重构）

---

## 一、背景与目标

### 1.1 现状问题

当前 Agent 工作台（`/employee/agent`）位于主后台 SPA 内部，挂载在 `Sidebar` 主导航之下，存在以下问题：

1. **简陋**：经典三栏（侧栏 + 消息列表 + 输入区），样式偏白底浅灰、单调蓝色，缺乏品牌识别。
2. **碎片化**：Agent 卡片每个 block 一个浅卡，整体视觉破碎，无信息层级。
3. **Composer 贴边**：输入框直接贴底栏边缘，无浮起感，按钮裸露。
4. **空态简陋**：无引导，只显示"请选择或创建会话"。
5. **导航场景冲突**：HR 处理招聘业务时频繁切到 Agent，主侧栏会被覆盖、不便并行。

### 1.2 设计目标

| 目标 | 验收标准 |
|---|---|
| **沉浸感** | Agent 工作台在独立浏览器 Tab 中打开，不挂主侧栏 |
| **并行作业** | 多会话可同时开多个 Tab，互不阻塞 HR 主流程 |
| **品牌一致** | 沿用主后台深空蓝品牌色，作为 TopBar 强调 |
| **信息密度** | 抽屉式侧栏默认 64px，给对话区最大画布 |
| **专业感** | 企业 HR SaaS 风格：高对比文本、扁平卡片、清晰层级 |
| **不增加新 token** | 复用现有 sidebar / Plus Jakarta Sans 字体体系 |

---

## 二、交互模式决策

### 2.1 入口行为

**侧边栏「Agent 工作台」点击** → `window.open('/employee/agent', '_blank')` 打开新浏览器 Tab。

- 新 Tab 路由复用 `/employee/agent`，但渲染独立的 `AgentStandaloneLayout`（不挂 `AdminLayout` 主侧栏）
- 通过 URL 参数或路由判断决定是否使用独立 layout
- 多会话场景 = 多个 Tab，浏览器原生 Tab 切换即可

### 2.2 视觉风格决策

| 维度 | 决策 |
|---|---|
| 主题 | **专业蓝 + 明亮工作区**（不做 dark mode） |
| 主色 | Navy `#0F172A` (TopBar/Sidebar) + Sky `#0369A1` (CTA) |
| 字体 | Plus Jakarta Sans（ui-ux-pro-max 推荐） |
| 思考模式色 | 紫 `#7C3AED`（与主蓝区分） |

### 2.3 布局决策

**布局方案 C：抽屉式侧栏**
- 默认 64px 窄条（仅图标 + 未读点）
- hover/click 展开 280px overlay
- 鼠标移出 2s 自动收回

**右栏 Trace 面板：不做**（现有 StepStrip 已足够；保持画布清爽）

---

## 三、设计 Tokens

新建文件：`frontend/src/components/employee/agent/design/agent-tokens.ts`（仅 Agent 工作台使用，不污染全局）。

### 3.1 颜色 Token

```ts
export const agentColors = {
  brand: {
    navy:    '#0F172A',  // TopBar / Sidebar 底
    navy2:   '#082F49',  // 渐变起点（沿用主 Sidebar）
    ink:     '#020617',  // 极暗，品牌强调底
    sky:     '#0369A1',  // 主 CTA
    sky2:    '#0EA5E9',  // hover / 焦点
    skyTint: '#E0F2FE',  // 选中态背景
  },
  surface: {
    app:     '#F8FAFC',  // 工作区底
    card:    '#FFFFFF',
    raised:  '#FFFFFF',  // 浮起卡片
    hover:   '#F1F5F9',
    muted:   '#E8ECF1',
  },
  text: {
    primary:      '#020617',
    secondary:    '#334155',
    tertiary:     '#64748B',
    disabled:     '#94A3B8',
    onBrand:      '#FFFFFF',
    onBrandMuted: 'rgba(255,255,255,0.7)',
  },
  semantic: {
    success:  '#16A34A', successBg:  '#DCFCE7',
    warning:  '#D97706', warningBg:  '#FEF3C7',
    danger:   '#DC2626', dangerBg:   '#FEE2E2',
    info:     '#0369A1', infoBg:     '#E0F2FE',
    thinking: '#7C3AED', thinkingBg: '#F3E8FF',  // 思考模式专色
  },
  border: {
    subtle:  '#E2E8F0',
    default: '#CBD5E1',
    strong:  '#94A3B8',
    focus:   '#0EA5E9',
  },
};
```

### 3.2 字体 / 间距 / 圆角 / 阴影 Token

```ts
export const agentTypography = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, 'PingFang SC', sans-serif",
  fontSize:   { xs: 12, sm: 13, base: 14, md: 15, lg: 16, xl: 18, '2xl': 22, '3xl': 28 },
  lineHeight: { tight: 1.3, normal: 1.5, relaxed: 1.7 },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
};

export const agentSpacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 };

export const agentRadius = { sm: 6, md: 10, lg: 14, xl: 18, '2xl': 22, full: 9999 };
// 气泡 = lg / 卡片 = xl / Composer = 2xl / 圆形按钮 = full

export const agentShadow = {
  sm:   '0 1px 2px rgba(15,23,42,0.06)',
  md:   '0 4px 12px rgba(15,23,42,0.08)',
  lg:   '0 8px 24px rgba(15,23,42,0.10)',     // Composer 浮卡
  xl:   '0 16px 40px rgba(15,23,42,0.14)',    // 抽屉 overlay
  ring: '0 0 0 3px rgba(14,165,233,0.25)',    // 焦点
};

export const agentMotion = {
  duration: { fast: 150, normal: 220, slow: 320 },
  easing:   {
    standard:   'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  },
};
```

### 3.3 字体加载

在 `frontend/index.html` 或 `frontend/src/index.css` 顶部加入：

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
```

---

## 四、整体 Layout 结构

```
┌─ TopBar (h-14, navy 渐变) ────────────────────────────────────┐
│ [Logo+HR·Agent]   会话标题 · 日期        [← 返回后台] [👤 用户] │
├─┬──────────┬──────────────────────────────────────────────────┤
│ │  会话    │                                                  │
│ │  侧栏    │           对话主区 (max-w-880, 居中)             │
│ │ 64/280px │   ┌──────────────────────────────────────────┐  │
│ │          │   │  空态 / 消息流 / 流式 blocks             │  │
│ │          │   └──────────────────────────────────────────┘  │
│ │          │   ┌─ Composer (浮卡, mb-6, shadow-lg) ───────┐  │
│ │          │   │  顶栏 + textarea + 底栏                  │  │
│ │          │   └──────────────────────────────────────────┘  │
└─┴──────────┴──────────────────────────────────────────────────┘
```

**关键组件文件**：
- `pages/employee/agent-standalone.tsx` — 独立 layout 入口（不挂 `AdminLayout`）
- `components/employee/agent/layout/agent-topbar.tsx` — 新建
- `components/employee/agent/layout/agent-sidebar-drawer.tsx` — 替换原 `agent-session-sidebar.tsx`
- `components/employee/agent/agent-workspace.tsx` — 重构（不再用 `flex h-screen bg-gray-50`，改用新 layout）

---

## 五、顶部品牌栏（TopBar）

### 5.1 视觉规范

| 区域 | 内容 | 样式 |
|---|---|---|
| 高度 | 56px | `h-14` |
| 背景 | 深空蓝渐变 | `bg-gradient-to-r from-[#082f49] to-[#0f172a]` |
| 边框 | 底部细线 | `border-b border-white/10` |
| 阴影 | 轻微 | `shadow-sm` |

### 5.2 内容布局

```
[Logo 32×32 蓝圆 "A"] [HR·Agent text-sm font-semibold]  |  ...
                                                        当前会话 text-xs text-white/70
                                                        |  [返回后台 link] [Avatar 32px]
```

- **Logo**: 32×32 `bg-sky-400 rounded-2xl text-slate-950 font-bold`，与主 Sidebar Logo 一致
- **品牌名**: "HR·Agent" 14px semibold 白
- **会话标题**: 居中区，13px text-white/70，"面试问题生成 · 2026-06-12"
- **返回后台**: 右侧 `<a href="/employee/dashboard" target="_top">` 配 `ArrowLeft` 图标，hover bg-white/10
- **用户头像**: 32×32 圆形灰蓝底白字缩写

### 5.3 响应式

- 屏宽 < 768px：会话标题隐藏
- 屏宽 < 480px：返回后台按钮变图标

---

## 六、抽屉式侧栏

### 6.1 折叠态（默认 64px）

```
┌─────────────┐
│  🔍 (搜索)   │
│             │
│  🤖 (激活)   │
│  •          │  ← 未读点
│             │
│  🤖         │
│             │
│  +          │  ← 新建会话 FAB
│             │
│  ⚙️         │
└─────────────┘
```

- 宽度 64px，背景白色 + `border-r border-subtle`
- 每个会话用 36×36 圆角图标，激活态 `bg-sky-100 text-sky-700` + 左侧 3px 蓝竖条
- 未读：右上角 8×8 红圆点
- 新建按钮：圆形 40×40 绿色 FAB 配 Plus 图标
- 底部齿轮：设置入口（未来扩展，目前 placeholder）

### 6.2 展开态（hover/click → 280px overlay）

```
┌────────────────────────────────┐
│ 🔍 搜索会话                     │  h-9 rounded-lg
├────────────────────────────────┤
│ 今天                            │  text-xs uppercase tracking-wider
│ │🤖 面试问题生成           ·3   │  激活 = 左 3px 蓝竖条 + bg-sky-50
│ │🤖 评估候选人简历              │
│ 昨天                            │
│ │🤖 JD 优化建议                 │
│ │🤖 批量简历初筛           ·12  │  红色未读 badge
│ 更早                            │
│ │🤖 评估模板讨论                │
├────────────────────────────────┤
│         + 新建会话              │  底部按钮 bg-sky-600 text-white
└────────────────────────────────┘
```

### 6.3 展开/收回逻辑

```ts
const [pinned, setPinned] = useState(false);   // 显式 pin
const [hovered, setHovered] = useState(false);
const expanded = pinned || hovered;

// 鼠标进入：立即展开
// 鼠标离开：2s 延迟收回（避免误触收回）
// 点击会话：自动收回（除非 pinned）
// 点击侧栏右上角 📌 图钉：固定展开
```

- 展开时使用 `position: absolute` overlay 在内容区之上，shadow-xl，z-30
- `width 64 → 280` 用 `transition-[width] duration-220 ease-standard`
- 内容区不需要让位，画布始终最大

### 6.4 会话分组逻辑

按 `last_message_time` 降序，分组：

| 分组 | 范围 |
|---|---|
| 今天 | 今天 00:00 至现在 |
| 昨天 | 昨天 00:00–23:59 |
| 本周更早 | 周一 00:00 至前天 23:59 |
| 更早 | 本周之前 |

---

## 七、消息区

### 7.1 空态

```
                  ┌─────┐
                  │ 🤖  │   80×80 渐变圆 (sky → sky2)
                  └─────┘

           你好，我能帮你做什么？
           (text-xl semibold)

       选一个 workflow 开始，或直接输入需求
       (text-sm text-tertiary)

   ┌──────────────┐  ┌──────────────┐
   │ 📋 面试问题   │  │ 📊 简历评估   │
   │ 基于 JD/简历  │  │ 多维度打分    │
   │ 生成题库      │  │ 给出建议      │
   └──────────────┘  └──────────────┘
```

- 整体居中，距顶 25vh
- workflow 卡片：240×120 rounded-xl border-subtle hover:border-sky-400 hover:shadow-md
- 点击卡片 → 切换 composer workflow + focus textarea

### 7.2 用户气泡

| 属性 | 值 |
|---|---|
| 对齐 | 右 |
| 背景 | `bg-sky-600` |
| 文字 | `text-white text-sm` |
| 圆角 | `rounded-2xl rounded-br-md`（右下角不对称） |
| 最大宽 | `max-w-[560px]` |
| 内边距 | `px-4 py-2.5` |
| 附件 | 气泡内底部 chip 风格显示文件名 |

### 7.3 Agent 卡片块

**核心改动**：从"每个 block 一张小卡"改为"一条 Agent 消息 = 一张大卡，内部用 divider 分隔"。

```
┌─ Agent 大卡 (border border-subtle rounded-xl bg-white) ────┐
│ ┌─ StepStrip sticky 顶部 ─────────────────────────────────┐│
│ │ ✓ 解析简历 ─ ◐ 生成题目 ─ ○ 总结                       ││
│ └─────────────────────────────────────────────────────────┘│
│ ──────────────────────────────────────────────────────────│
│ 💭 思考过程 (折叠态，紫色左边框 3px)              ▾       │
│ ──────────────────────────────────────────────────────────│
│ 文本 block (markdown 渲染, line-height 1.7)               │
│ ──────────────────────────────────────────────────────────│
│ 卡片化结果 block (Q1 · 中等 · 算法 ...)                   │
│ ──────────────────────────────────────────────────────────│
│ 🔧 工具调用 (灰色, vector_search · 0.8s · 命中 12 条)     │
│ ──────────────────────────────────────────────────────────│
│ Footer: gpt-4o · 1.2k token · 12:34   📋 复制 ↻ 重试    │
└────────────────────────────────────────────────────────────┘
```

#### Step Strip 状态视觉

| 状态 | 图标 | 颜色 |
|---|---|---|
| 待执行 | 空圆圈 ○ | `text-gray-300` |
| 执行中 | 旋转 spinner ◐ | `text-sky-500 animate-spin` |
| 已完成 | 实心勾 ✓ | `text-success bg-success-bg` |
| 失败 | 实心 X | `text-danger bg-danger-bg` |

#### Block 类型映射

| 协议 block type | 视觉 |
|---|---|
| `text` | markdown 渲染 |
| `thinking` | 紫色左边框 3px + 默认折叠 |
| `tool_call` | 灰底 chip + 工具名 + 耗时 |
| `interaction` | 表单/按钮，框住可点击 |
| `structured_data` | 卡片网格（Q&A、评分项等） |
| `error` | 红色框 |

### 7.4 流式渲染

- 复用 `useAgentRun` + `use-follow-bottom`（智能粘附滚动）
- 流式期间 StepStrip 实时更新当前 step
- 当前正在构造的 block 用 fade-in 150ms 入场
- 流式结束 smooth-scroll 对齐到底

---

## 八、Composer 浮卡式输入区

### 8.1 容器

```css
/* 外层 */
position: sticky;
bottom: 0;
padding: 0 16px 24px 16px;     /* 底部留 24px 间隙 */
background: linear-gradient(to top, var(--app-bg) 60%, transparent);

/* 卡片本身 */
max-width: 880px;
margin: 0 auto;
border-radius: 22px;            /* rounded-2xl */
background: white;
border: 1px solid var(--border-subtle);
box-shadow: 0 8px 24px rgba(15,23,42,0.10);
transition: box-shadow 220ms;
```

**focus 内部时**：整卡 `box-shadow: 0 0 0 3px rgba(14,165,233,0.25)` 焦点光晕。

### 8.2 顶栏

| 元素 | 位置 | 样式 |
|---|---|---|
| Workflow 分段 | 左 | pill 风格：`rounded-full bg-gray-100 p-0.5`，选中态 `bg-white shadow-sm text-text-primary` |
| 思考模式 chip | 右 | 灰底关闭 / 紫底开启，⚡ 图标 + "思考" + 状态 |

### 8.3 附件 chip（条件渲染）

```
📎 张三_简历.pdf · 234 KB                                    ✕
```

- bg-gray-50 rounded-lg px-3 py-1.5 text-xs
- 文件大小 text-tertiary
- 移除按钮 hover:text-danger

### 8.4 textarea

```css
border: none;
outline: none;
resize: none;
min-height: 48px;
max-height: 160px;       /* 自动伸缩，max 10 行 */
padding: 12px 0;         /* 上下，左右无 */
font-size: 14px;
line-height: 1.6;
color: var(--text-primary);
placeholder-color: var(--text-tertiary);
```

### 8.5 底栏

| 区域 | 内容 |
|---|---|
| 左 | 📎 附简历（text-tertiary hover:text-sky-600） |
| 中 | "Ctrl+Enter 发送" 11px text-tertiary（仅 desktop 显示） |
| 右 | [取消] [发送 ▶] 或 [■ 停止] |

- **发送按钮**：`h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium`
- **disabled**：`opacity-40 cursor-not-allowed`
- **流式中**：替换为 "■ 停止" `bg-danger text-white`

---

## 九、微交互动效

| 场景 | 动效 | 时长 |
|---|---|---|
| 侧栏展开 | `width 64→280` ease-standard | 220ms |
| 抽屉收起 | 鼠标离开 2s 延迟 + opacity 渐弱 | 220ms |
| 消息气泡入场 | `opacity 0→1 + translateY 8→0` ease-out | 220ms |
| Step 完成 | 绿勾 `scale 0.6→1` spring | 320ms |
| Step 进行中 | spinner 旋转 | 1s loop |
| 按钮按下 | `scale 0.97` | 100ms |
| workflow 切换 | pill 指示器滑动 | 220ms |
| 思考模式切换 | chip 颜色 cross-fade | 150ms |
| 流式 block 入场 | fade-in | 150ms |
| Composer focus | shadow ring 渐入 | 220ms |

**全局原则**：所有动效遵循 `prefers-reduced-motion` 自动禁用。

---

## 十、组件文件结构

新建/修改如下：

```
frontend/src/
├── api/employee/agent.ts                          # 不变
├── types/agent.ts                                 # 不变
├── utils/agent-stream-client.ts                   # 不变
├── utils/agent-run-reducer.ts                     # 不变
├── hooks/use-agent-run.ts                         # 不变
├── hooks/use-follow-bottom.ts                     # 不变
│
├── pages/employee/
│   └── agent.tsx                                  # 改：直接渲染 AgentStandaloneLayout
│
└── components/employee/agent/
    ├── design/
    │   └── agent-tokens.ts                        # 新建：颜色/字体/间距/动效 token
    │
    ├── layout/
    │   ├── agent-standalone-layout.tsx            # 新建：独立 Layout 容器
    │   ├── agent-topbar.tsx                       # 新建：顶部品牌栏
    │   └── agent-sidebar-drawer.tsx               # 新建：抽屉式侧栏（替换旧 sidebar）
    │
    ├── agent-workspace.tsx                        # 改：用新 layout 重构
    ├── agent-message-list.tsx                     # 改：空态 + Agent 卡片化
    ├── agent-composer.tsx                         # 改：浮卡式 + 新视觉
    │
    ├── empty-state.tsx                            # 新建：空态组件 + workflow 快捷卡
    ├── agent-message-card.tsx                     # 新建：Agent 大卡（包含所有 block）
    │
    ├── step-strip.tsx                             # 改：新视觉
    └── blocks/
        ├── block-renderer.tsx                     # 改：用 divider 分隔，去掉每 block 的卡片
        ├── text-block.tsx                         # 不变
        ├── thinking-block.tsx                     # 改：紫色左边框 + 折叠
        ├── tool-call-block.tsx                    # 改：灰底 chip
        ├── interaction-block.tsx                  # 不变
        ├── structured-data-block.tsx              # 改：卡片网格
        └── error-block.tsx                        # 不变
```

### 旧 sidebar 处理

`components/employee/agent/agent-session-sidebar.tsx` → **删除**（被 `layout/agent-sidebar-drawer.tsx` 取代）。

---

## 十一、入口跳转改造

### 11.1 主 Sidebar 改造

`frontend/src/components/layout/sidebar.tsx` 的 Agent 入口：

```tsx
// 之前
{ href: '/employee/agent', icon: Bot, label: 'Agent 工作台' }

// 改造后：用 onClick + window.open 而不是 Link
<button
  onClick={() => window.open('/employee/agent', '_blank', 'noopener')}
  className="..."
>
  <Bot size={18} />
  <span>Agent 工作台</span>
  <ExternalLink size={12} className="ml-auto opacity-50" />
</button>
```

### 11.2 路由改造

本项目中 `AdminLayout` 由各个 page 自己挂载（如 `pages/employee/jobs.tsx` 顶层包 `<AdminLayout>`），并非在 `App.tsx` 统一包裹。当前 `pages/employee/agent.tsx` **已经没有挂 `AdminLayout`**（直接渲染 `<AgentWorkspace />`），所以路由层无需改造。

只需在 `pages/employee/agent.tsx` 内将原 `<AgentWorkspace />` 替换为新的 `<AgentStandaloneLayout>`：

```tsx
// pages/employee/agent.tsx
import { AgentStandaloneLayout } from '@/components/employee/agent/layout/agent-standalone-layout';

export default function AgentPage() {
  return <AgentStandaloneLayout />;
}
```

`AgentStandaloneLayout` 内部包含：TopBar + DrawerSidebar + AgentWorkspace 主区。

---

## 十二、Tab 标题策略

新 Tab 打开后，浏览器标题应反映当前激活会话：

```ts
useEffect(() => {
  const title = activeSession?.title || '新会话';
  document.title = `${title} · HR·Agent`;
}, [activeSession]);
```

---

## 十三、验收标准

| 项 | 校验方式 |
|---|---|
| 主侧栏点 Agent → 打开新 Tab | 人工验证 |
| 新 Tab 不挂主 AdminLayout 主侧栏 | 人工验证 |
| 抽屉 64px 默认窄条，hover 展开 280px | 人工验证 |
| 鼠标离开 2s 抽屉收回 | 人工验证 |
| Plus Jakarta Sans 已加载 | DevTools Network 验证 |
| 所有颜色来自 agent-tokens.ts | 代码审查 |
| Composer 浮卡 shadow-lg + 底部 24px 间隙 | 人工验证 |
| Agent 消息为一张大卡，block 用 divider 分隔 | 人工验证 |
| 空态显示 workflow 快捷卡 | 人工验证 |
| 思考块默认折叠，紫色左边框 | 人工验证 |
| StepStrip 状态正确（待办/进行中/完成） | 人工验证 |
| Tab 标题 = "会话标题 · HR·Agent" | 人工验证 |
| 所有 hover/focus 动效 150-320ms | 人工验证 |
| `prefers-reduced-motion` 时禁用动效 | DevTools 模拟验证 |
| 4.5:1 文本对比度 | 浏览器扩展验证 |
| Tab 键导航顺序合理 | 键盘验证 |
| 测试 1280/1440/1920 三个屏宽 | 人工验证 |

---

## 十四、不在本次范围

| 项 | 原因 |
|---|---|
| Dark mode | 用户选了"明亮工作区" |
| 右栏 Trace 面板 | 用户选了"不需要 Trace" |
| 多会话内 Tab 切换 | 用户选了"新浏览器 Tab"模式 |
| 移动端适配 | HR 后台场景为 desktop 优先 |
| 国际化 | 全中文 |
| 后端协议变更 | 复用现有 stream protocol v2 |

---

**END OF DESIGN**
