# 员工端（HR/管理员）功能设计文档

> 本文档定义招聘平台员工端的完整功能设计，作为实现依据。

## 一、角色与权限

### 1.1 角色定义

| 角色 | 说明 | 权限范围 |
|------|------|---------|
| **超级管理员** | 系统管理员 | 可操作所有数据，不受部门限制 |
| **HR** | 招聘专员 | 仅可操作所属部门的数据 |

### 1.2 权限控制

- **数据权限**：基于 `sys_employee_role` 和 `sys_role_menu` 的 RBAC 体系
- **部门隔离**：HR 角色只能查看/操作本部门的岗位和投递
- **超级管理员**：可查看/操作所有数据

---

## 二、页面结构

```
/employee
├── /login                    # 员工登录
├── /dashboard               # 工作台（数据统计 + 最近动态）
├── /jobs                     # 岗位管理
│   ├── /jobs                # 岗位列表
│   ├── /jobs/create         # 创建岗位（+AI生成技能）
│   └── /jobs/:id/edit       # 编辑岗位
├── /resumes                  # 简历库
│   ├── /resumes             # 全部简历
│   ├── /resumes/pending     # 待评估简历
│   └── /resumes/:id         # 简历详情
├── /evaluations              # 评估管理
│   ├── /evaluations         # 评估列表（岗位选择 + 匹配度分布）
│   └── /evaluations/:id     # 评估详情 + 雷达图 + 技能命中
├── /applications             # 投递管理
│   ├── /applications        # 投递列表
│   └── /applications/:id    # 投递详情
└── /analytics                # 可视化报表
    └── /analytics/job/:id    # 岗位匹配度报表
```

---

## 三、页面功能详细设计

### 3.1 员工登录 `/employee/login`

**功能描述**：员工账号登录，支持员工号/邮箱 + 密码登录。

**页面元素**：
- 登录表单：员工号/邮箱、密码
- 登录方式切换：密码登录 / 验证码登录
- 记住登录状态
- 忘记密码链接（暂不实现）

**交互流程**：
1. 用户输入员工号/邮箱 + 密码
2. 前端校验输入格式
3. 调用 `POST /api/v1/employee/auth/login`
4. 成功：存储 Token，跳转工作台
5. 失败：显示错误提示

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/auth/login` | 员工登录 |
| POST | `/api/v1/employee/auth/send-code` | 发送验证码 |
| POST | `/api/v1/employee/auth/logout` | 登出 |
| POST | `/api/v1/employee/auth/refresh` | 刷新Token |

---

### 3.2 工作台 `/employee/dashboard`

**功能描述**：展示关键数据统计、最近动态、快捷操作入口。

**页面元素**：

#### 3.2.1 统计卡片（4个）
| 指标 | 数据来源 |
|------|---------|
| 在招岗位数 | `job_position.status=1` 统计 |
| 简历总数 | `resume` 表总数 |
| 待评估数 | `resume.status=0` 且未匹配的数量 |
| 平均匹配率 | `resume_job_match.final_score` 平均值 |

#### 3.2.2 最近动态列表
- 显示最近 10 条动态
- 类型：简历投递、评估完成、新简历上传、岗位发布等
- 每条显示：描述文本 + 时间

#### 3.2.3 快捷操作入口（4个）
| 入口 | 跳转路径 |
|------|---------|
| 发布岗位 | `/employee/jobs/create` |
| 批量评估 | `/employee/evaluations` |
| 简历库 | `/employee/resumes` |
| 岗位管理 | `/employee/jobs` |

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/dashboard` | 获取工作台统计数据 |

---

### 3.3 岗位管理 `/employee/jobs`

#### 3.3.1 岗位列表 `/employee/jobs`

**页面元素**：
- 筛选条件：部门、状态（招聘中/已下架）
- 岗位卡片列表：
  - 岗位名称
  - 所属部门
  - 状态标签（招聘中/已下架）
  - 发布时间
  - 收到简历数
  - 操作按钮：编辑、删除

**交互**：
- 点击「创建岗位」跳转 `/employee/jobs/create`
- 点击「编辑」跳转 `/employee/jobs/:id/edit`
- 点击「删除」二次确认后删除

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 岗位列表 |
| DELETE | `/api/v1/employee/jobs/:id` | 删除岗位 |

#### 3.3.2 创建岗位 `/employee/jobs/create`

**页面元素**：
- 岗位名称输入框（必填）
- 岗位描述文本域
- 部门选择下拉框
- AI 生成技能建议按钮
- 技能列表（可增删改）
  - 技能名称
  - 类型：必须满足 / 优先匹配 / 普通技能
- 提交按钮

**AI 技能建议**：
- 点击「AI生成技能建议」按钮
- 调用 `POST /api/v1/employee/jobs/skill/suggest`
- 返回技能建议列表，类型 1/2/3 对应：必须满足/优先匹配/普通技能
- HR 可编辑确认后再提交

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/jobs` | 创建岗位 |
| POST | `/api/v1/employee/jobs/skill/suggest` | AI生成技能建议 |

#### 3.3.3 编辑岗位 `/employee/jobs/:id/edit`

**页面元素**：
- 同创建岗位，字段预填充
- 额外显示：收到简历数、创建时间
- 保存按钮

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs/:id` | 获取岗位详情 |
| PUT | `/api/v1/employee/jobs/:id` | 更新岗位 |

---

### 3.4 简历库 `/employee/resumes`

#### 3.4.1 全部简历 `/employee/resumes`

**页面元素**：
- 筛选条件：处理状态（待处理/评估完成/处理失败）、上传时间范围
- 简历卡片列表：
  - 文件名
  - 上传者（用户ID，可跳转查看）
  - 处理状态标签
  - 上传时间
  - 操作：查看详情

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes` | 全部简历列表 |

#### 3.4.2 待评估简历 `/employee/resumes/pending`

**页面元素**：
- 仅显示 `resume.status=0` 的简历
- 可直接发起评估

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes/pending` | 待评估简历列表 |

#### 3.4.3 简历详情 `/employee/resumes/:id`

**页面元素**：
- 简历基本信息：文件名、上传时间、状态
- 简历内容预览（raw_text 文本展示）
- 关联的投递记录列表
- 评估结果列表（如果已评估）

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes/:id` | 简历详情 |

---

### 3.5 评估管理 `/employee/evaluations`

#### 3.5.1 评估列表 `/employee/evaluations`（核心页面）

**页面布局**：左侧岗位选择 + 中间简历列表 + 右侧操作面板

**页面元素**：

##### 左侧：岗位选择器
- 下拉选择目标岗位
- 显示岗位基本信息（名称、部门、状态）

##### 中间：简历列表 + 匹配度分布
- **匹配度分布饼图**（使用 Recharts PieChart）
  - 数据：优秀/良好/一般/未达标 四个分类的数量和占比
  - 颜色：优秀=#10B981（绿色）、良好=#2563EB（蓝色）、一般=#F59E0B（黄色）、未达标=#EF4444（红色）
- **简历列表**（按匹配度降序）
  - 每条显示：
    - 简历文件名（**支持点击预览**）
    - 匹配度分数
    - 标签（优秀/良好/一般/未达标）
    - 关键技能匹配情况
    - 查看详情按钮

##### 右侧：批量评估操作面板
- 已选简历计数
- 目标岗位确认
- 「开始评估」按钮

**交互流程**：
1. 选择目标岗位 → 右侧面板更新为该岗位下简历的匹配度分布
2. 勾选简历 → 已选计数更新
3. 点击「开始评估」→ 调用批量评估接口 → **立即返回"评估任务已提交，请稍后查看"**

**评估状态说明**：
- 简历未评估：`evaluation_status = 'pending'`，显示"待评估"
- 评估中：`evaluation_status = 'processing'`，显示"评估中"
- 评估完成：`evaluation_status = 'completed'`，显示匹配度标签
- 评估失败：`evaluation_status = 'failed'`，显示"评估失败，可重试"

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 获取岗位列表（用于选择） |
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 匹配度分布（饼图数据） |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 简历列表（按匹配度降序） |
| POST | `/api/v1/employee/evaluations/batch` | 批量触发评估（Celery异步） |

#### 3.5.2 评估详情 `/employee/evaluations/:match_id`

**页面元素**：

##### 基本信息
- 简历文件名（可点击预览）
- 评估时间
- 匹配度分数（0-100）
- 标签（优秀/良好/一般/未达标）

##### 匹配度进度条
- 显示得分百分比

##### 雷达图（多维度得分）
- 使用 `EvaluationRadarChart` 组件
- 各维度：技术能力、项目经验、学历背景、稳定性、工作经验等
- 每个维度显示：维度名称、得分、优缺点

##### 优缺点评价
- 优点：`advantage_comment`
- 缺点：`disadvantage_comment`（为空时显示"这份好像挺符合岗位预期"）

##### 技能命中详情
- 表格展示：
  | 技能 | 类型 | 命中 | 匹配度 | 片段 |
  |------|------|------|--------|------|
  | React | 必须满足 | ✓ | 优秀 | 点击查看 |
  | TypeScript | 优先匹配 | ✓ | 良好 | 点击查看 |
  | Node.js | 普通技能 | ✗ | — | — |

- 点击「片段」弹出 Dialog 显示命中原文

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/evaluations/:match_id` | 评估详情 |
| GET | `/api/v1/employee/evaluations/:match_id/skill-hits` | 技能命中详情 |

#### 3.5.3 Celery 异步评估设计

**任务流程**：
```
员工提交批量评估请求
        ↓
┌─────────────────────────────────────┐
│ POST /api/v1/employee/evaluations/batch │
│ { resume_ids: [1,2,3], job_id: 5 }  │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│ 立即返回：{ code: 200, message:     │
│ "评估任务已提交，请稍后查看" }      │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│ Celery Task: eval_batch_task        │
│ - queue: eval                       │
│ - retry: 3次                        │
│ - retry_backoff: 指数退避 (2s,4s,8s)│
└─────────────────────────────────────┘
        ↓
对每份简历执行评估：
┌─────────────────────────────────────┐
│ 1. 读取简历 raw_text               │
│ 2. 读取岗位技能列表                 │
│ 3. 读取岗位评估维度                 │
│ 4. 对每个维度调用 LLM Chain        │
│ 5. 技能命中检测                    │
│ 6. 汇总计算最终得分                │
│ 7. 存入数据库                      │
└─────────────────────────────────────┘
```

**重试机制**：
- 最大重试次数：3次
- 指数退避：2s → 4s → 8s
- 重试条件：LLM 调用超时、API 限流、临时网络错误
- 不重试：参数错误、数据不存在、内容格式错误

**兜底方案（重试全部失败后）**：
- 评估结果标记为 `status=failed`
- 记录失败原因到 `resume_job_match.error_message`
- 前端显示"评估失败，可重试"按钮
- HR 可手动触发重试

**异常处理**：
| 异常情况 | 处理方式 |
|---------|---------|
| LLM 超时 | 重试3次，指数退避 |
| API 限流 | 等待队列，指数退避 |
| 简历内容为空 | 标记失败，记录原因 |
| 岗位信息不存在 | 标记失败，记录原因 |
| 网络错误 | 重试3次后标记失败 |

#### 3.5.5 LLM Agent 评估链设计

**技术选型**：LangChain + LiteLLM

**核心思想**：将评估流程拆分为独立的 Agent 链，每个链负责特定任务，通过消息传递协作。

##### 评估链架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Resume Evaluation Agent                      │
│                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ Resume      │───▶│ Skill       │───▶│ Dimension           │  │
│  │ Parser      │    │ Matcher     │    │ Evaluator           │  │
│  │ (文本提取)   │    │ (技能命中)   │    │ (多维度评估)         │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                │                │
│                                                ▼                │
│                                      ┌─────────────────────┐    │
│                                      │ Score Aggregator    │    │
│                                      │ (得分汇总+标签)      │    │
│                                      └─────────────────────┘    │
│                                                │                │
│                                                ▼                │
│                                      ┌─────────────────────┐    │
│                                      │ Comment Generator   │    │
│                                      │ (优缺点评价生成)     │    │
│                                      └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Evaluation Result   │
                    │ - final_score       │
                    │ - final_label       │
                    │ - dimensions[]      │
                    │ - skill_hits[]      │
                    │ - advantage_comment │
                    │ - disadvantage_comm │
                    └─────────────────────┘
```

##### Agent 详细设计

**1. Resume Parser（简历解析）**
```python
class ResumeParserAgent:
    """解析简历文本，提取关键信息"""

    def parse(self, raw_text: str) -> ResumeStructuredData:
        """
        输出结构:
        {
            "personal_info": {"name": "", "email": ""},
            "education": [{"school": "", "degree": "", "major": ""}],
            "work_experience": [{"company": "", "position": "", "duration": "", "description": ""}],
            "skills": ["React", "TypeScript", "..."],
            "projects": [{"name": "", "role": "", "description": ""}]
        }
        """
```

**2. Skill Matcher（技能匹配）**
```python
class SkillMatcherAgent:
    """检测简历中技能的命中情况"""

    def match(self, resume_data: ResumeStructuredData, job_skills: list[JobSkill]) -> list[SkillHit]:
        """
        对每个岗位技能检测是否在简历中命中
        输出: list[SkillHit]
        """
```

**3. Dimension Evaluator（维度评估）**
```python
class DimensionEvaluatorAgent:
    """对每个评估维度进行打分"""

    async def evaluate(self, resume_data: ResumeStructuredData, dimension: JobEvalDimension) -> DimensionScore:
        """
        输出: DimensionScore
        {
            "dimension_name": "技术能力",
            "score": 85,
            "advantage": "熟练掌握React生态...",
            "disadvantage": "TypeScript类型设计能力有待提升...",
            "is_completed": true,
            "error_message": null  // 失败时记录错误信息
        }
        """

    async def evaluate_batch(self, resume_data: ResumeStructuredData, dimensions: list[JobEvalDimension]) -> list[DimensionScore]:
        """并行评估所有维度（asyncio.gather）"""
        tasks = [self.evaluate(resume_data, dim) for dim in dimensions]
        return await asyncio.gather(*tasks, return_exceptions=True)
```

**并行评估处理**：
- 使用 `asyncio.gather(*tasks, return_exceptions=True)` 并行执行所有维度评估
- 单个维度失败不影响其他维度，失败维度返回 `is_completed=false` + `error_message`
- 最终汇总时，失败维度不计入权重计算，使用其他成功维度重新归一化权重

**4. Score Aggregator（得分汇总）**
```python
class ScoreAggregatorAgent:
    """汇总各维度得分，计算加权总分和标签"""

    def aggregate(self, dimension_scores: list[DimensionScore], weights: list[float]) -> FinalScore:
        """
        final_score = Σ(dimension_score * weight)
        final_label: 90-100=优秀, 70-89=良好, 50-69=一般, 0-49=未达标
        """
```

**5. Comment Generator（评价生成）**
```python
class CommentGeneratorAgent:
    """生成优缺点评价"""

    def generate(self, resume_data: ResumeStructuredData, dimension_scores: list[DimensionScore]) -> CommentResult:
        """
        输出: CommentResult
        {
            "advantage_comment": "候选人具备扎实的React技术栈实战经验...",
            "disadvantage_comment": ""  // 无明显缺点时为空字符串
        }
        """
```

##### Chain 执行流程

```python
# 评估主流程
async def evaluate_resume(resume_id: int, job_id: int) -> EvaluationResult:
    # 1. 获取数据
    resume = await get_resume(resume_id)
    job = await get_job(job_id)
    job_skills = await get_job_skills(job_id)
    dimensions = await get_job_dimensions(job_id)

    # 2. 解析简历
    parser = ResumeParserAgent()
    resume_data = parser.parse(resume.raw_text)

    # 3. 技能匹配（并行）
    skill_matcher = SkillMatcherAgent()
    skill_hits = await skill_matcher.match_async(resume_data, job_skills)

    # 4. 维度评估（并行 - asyncio.gather）
    evaluator = DimensionEvaluatorAgent()
    dimension_scores = await evaluator.evaluate_batch(resume_data, dimensions)
    # dimension_scores 可能包含 Exception，需处理

    # 5. 得分汇总（只计算 is_completed=true 的维度）
    aggregator = ScoreAggregatorAgent()
    completed_scores = [ds for ds in dimension_scores if ds.is_completed]
    completed_weights = [d.weight for d, ds in zip(dimensions, dimension_scores) if ds.is_completed]
    # 重新归一化权重
    final_score = aggregator.aggregate(completed_scores, completed_weights)

    # 6. 生成评价（使用成功的维度）
    comment_gen = CommentGeneratorAgent()
    comments = comment_gen.generate(resume_data, completed_scores)

    # 7. 返回结果
    return EvaluationResult(
        final_score=final_score.score,
        final_label=final_score.label,
        dimensions=dimension_scores,  # 包含失败维度（is_completed=false）
        skill_hits=skill_hits,
        advantage_comment=comments.advantage_comment,
        disadvantage_comment=comments.disadvantage_comment
    )
```

**并行评估异常处理**：
```python
async def evaluate_batch(self, resume_data, dimensions):
    tasks = [self.evaluate(resume_data, dim) for dim in dimensions]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    dimension_scores = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            # 评估失败，记录错误信息
            dimension_scores.append(DimensionScore(
                dimension_name=dimensions[i].dimension_name,
                score=50,  # 默认分
                advantage="",
                disadvantage="",
                is_completed=False,
                error_message=str(result)
            ))
        else:
            dimension_scores.append(result)

    return dimension_scores
```

##### LiteLLM 配置

```python
# ai/client.py
from litellm import litellm

litellm_settings = {
    "model": "gpt-4-turbo-preview",
    "fallback_model": "gpt-3.5-turbo",
    "max_retries": 3,
    "timeout": 60,  # 60秒超时
}

# 模型切换示例
models = {
    "openai": "gpt-4-turbo-preview",
    "anthropic": "claude-3-opus-20240229",
    "local": "llama2-70b",
    "azure": "azure/gpt-4-turbo"
}
```

##### Prompt 模板设计

每个 Agent 有独立的 Prompt 模板，存放在 `backend/app/utils/ai/prompts/` 目录下：

```
prompts/
├── skill_match_prompt.txt      # 技能匹配 Prompt
├── dimension_eval_prompt.txt    # 维度评估 Prompt
├── comment_gen_prompt.txt       # 评价生成 Prompt
└── skill_suggest_prompt.txt    # 技能建议 Prompt
```

**Prompt 设计原则**：
1. 结构化输入输出，明确 JSON 格式要求
2. 评分标准量化（0-100 分）
3. 异常处理明确（内容不足、无技能匹配等情况）
4. 避免幻觉：优点必须来自简历原文

##### 容错机制

| 环节 | 失败处理 |
|------|---------|
| 简历解析 | 返回空结构，标记需要人工审核 |
| 技能匹配 | 部分技能失败不影响其他，失败技能标记为 is_hit=false |
| 维度评估 | 单维度失败不影响其他维度，失败维度 is_completed=false，error_message 记录原因；该维度不参与权重计算 |
| 评价生成 | 失败时返回"候选人简历信息完整"等通用评价 |

**维度评估并行失败处理**：
- `asyncio.gather(*tasks, return_exceptions=True)` 确保即使单个失败也不中断其他
- 失败维度返回默认值：`score=50, is_completed=false`
- 最终得分汇总时只计算 `is_completed=true` 的维度，并重新归一化权重

#### 3.5.4 附件简历预览功能

**预览支持格式**：
- PDF（`.pdf`）
- Word（`.docx`）
- 图片（`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`）

**预览实现方案**：

| 格式 | 预览方案 | 说明 |
|------|---------|------|
| PDF | pdf.js 渲染 | 跨浏览器支持，无需本地安装 |
| Word | 转为 PDF 或提取文本预览 | 后端用 python-docx 提取文本，前端展示 |
| 图片 | 直接 `<img>` 标签 | 支持各种图片格式 |

**预览流程**：
```
1. 前端调用 GET /api/v1/employee/resumes/:id/file
2. 后端根据 file_path 检测文件类型
3. Word 文件：python-docx 提取文本内容返回
4. PDF/图片：返回文件流
5. 前端根据 Content-Type 渲染
```

**预览组件**：`ResumePreviewDialog`
```typescript
interface ResumePreviewDialogProps {
  resumeId: number;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'image';
  open: boolean;
  onClose: () => void;
}
```

**预览 API**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes/:id/file` | 获取简历文件流（PDF/图片）或提取文本（Word） |

---

### 3.6 投递管理 `/employee/applications`

#### 3.6.1 投递列表 `/employee/applications`

**页面元素**：
- 筛选条件：岗位、状态（待处理/已查看/面试中/已拒绝/已录用）
- 投递记录列表：
  - 求职者姓名（用户ID）
  - 投递岗位名称
  - 简历文件名
  - 投递时间
  - 当前状态标签
  - 操作：查看详情、更新状态

**状态更新**：
- 点击状态标签 → 下拉选择新状态
- 支持的状态流转：待处理 → 已查看 → 面试中 / 已拒绝 / 已录用

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications` | 投递列表 |
| PUT | `/api/v1/employee/applications/:id/status` | 更新投递状态 |

#### 3.6.2 投递详情 `/employee/applications/:id`

**页面元素**：
- 投递基本信息：求职者、岗位、简历、时间
- 当前状态
- 评估结果（如果已评估）：匹配度、标签
- 状态操作：更新状态按钮

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications/:id` | 投递详情 |

---

### 3.7 可视化报表 `/employee/analytics`

#### 3.7.1 岗位匹配度报表 `/employee/analytics/job/:id`

**页面元素**：
- 岗位信息卡片：名称、部门、收到简历数
- **匹配度分布饼图**
- **简历列表**（按匹配度降序，每条显示匹配度、标签、关键技能）
- 可直接点击简历进入评估详情

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 匹配度分布 |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 简历列表 |

---

## 四、组件清单

### 4.1 布局组件

| 组件 | 说明 |
|------|------|
| `PageLayout` | 页面布局：标题 + 副标题 + 操作区 + 内容区 |
| `EmployeeNav` | 员工端导航栏（顶部） |

### 4.2 业务组件

| 组件 | 说明 |
|------|------|
| `EvaluationRadarChart` | 多维度雷达图 |
| `MatchBadge` | 匹配度标签（优秀/良好/一般/未达标） |
| `MatchPieChart` | 匹配度分布饼图 |
| `SkillHitTable` | 技能命中详情表格 |
| `AdvantageComment` | 优点展示组件 |
| `DisadvantageComment` | 缺点展示组件（处理空字符串情况） |
| `ApplicationStatusSelect` | 投递状态选择下拉框 |
| `JobSelector` | 岗位选择器 |

### 4.3 UI 组件（shadcn/ui）

使用现有组件：`Button`, `Card`, `Input`, `Label`, `Textarea`, `Select`, `Dialog`, `Table`, `Badge`, `Progress` 等。

---

## 五、API 契约

### 5.1 认证 `/api/v1/employee/auth`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/auth/send-code` | 发送验证码 |
| POST | `/api/v1/employee/auth/login` | 员工登录 |
| POST | `/api/v1/employee/auth/refresh` | 刷新Token |
| POST | `/api/v1/employee/auth/logout` | 登出 |

### 5.2 岗位管理 `/api/v1/employee/jobs`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 岗位列表 |
| GET | `/api/v1/employee/jobs/:id` | 岗位详情 |
| POST | `/api/v1/employee/jobs` | 创建岗位 |
| PUT | `/api/v1/employee/jobs/:id` | 编辑岗位 |
| DELETE | `/api/v1/employee/jobs/:id` | 删除岗位 |

### 5.3 技能建议 `/api/v1/employee/jobs/skill`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/jobs/skill/suggest` | AI生成技能建议 |

### 5.4 简历库 `/api/v1/employee/resumes`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes` | 全部简历列表 |
| GET | `/api/v1/employee/resumes/:id` | 简历详情 |
| GET | `/api/v1/employee/resumes/:id/file` | 获取简历文件流 |
| GET | `/api/v1/employee/resumes/pending` | 待评估简历列表 |

### 5.5 评估管理 `/api/v1/employee/evaluations`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/evaluations/batch` | 批量触发评估 |
| GET | `/api/v1/employee/evaluations/:match_id` | 评估详情 |
| GET | `/api/v1/employee/evaluations/:match_id/skill-hits` | 技能命中详情 |

### 5.6 投递管理 `/api/v1/employee/applications`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications` | 全部投递记录列表 |
| GET | `/api/v1/employee/applications/:id` | 投递详情 |
| PUT | `/api/v1/employee/applications/:id/status` | 更新投递状态 |

### 5.7 可视化报表 `/api/v1/employee/analytics`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/dashboard` | 工作台统计 |
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 岗位匹配度分布 |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 岗位简历列表 |

---

## 六、数据模型

### 6.1 EmployeeDashboardStats（工作台统计）

```typescript
interface EmployeeDashboardStats {
  job_count: number;          // 在招岗位数
  resume_count: number;       // 简历总数
  pending_eval_count: number; // 待评估数
  avg_match_score: number;    // 平均匹配率
  recent_activities: Activity[]; // 最近动态
}

interface Activity {
  id: number;
  type: 'resume_upload' | 'application' | 'evaluation' | 'job_create';
  text: string;
  time: string;
}
```

### 6.2 MatchDistribution（匹配度分布）

```typescript
interface MatchDistribution {
  excellent: { count: number; percentage: number }; // 优秀
  good: { count: number; percentage: number };       // 良好
  average: { count: number; percentage: number };   // 一般
  fail: { count: number; percentage: number };      // 未达标
}
```

### 6.3 ResumeWithEvaluation（简历评估状态）

```typescript
interface ResumeWithEvaluation {
  resume_id: number;
  file_name: string;
  evaluation_status: 'pending' | 'processing' | 'completed' | 'failed';
  final_score?: number;       // evaluation_status=completed 时有值
  final_label?: string;      // evaluation_status=completed 时有值
  error_message?: string;    // evaluation_status=failed 时有值
}
```

### 6.3 EvaluationDetail（评估详情）

```typescript
interface EvaluationDetail {
  match_id: number;
  final_score: number;         // 0-100
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;   // 优点（可为空）
  disadvantage_comment: string; // 缺点（空时显示"这份好像挺符合岗位预期"）
  dimensions: DimensionScore[];
  skill_hits: SkillHit[];
}

interface DimensionScore {
  dimension_name: string;
  score: number;
  advantage: string;
  disadvantage: string;
  is_completed: boolean;   // 是否成功完成评估
  error_message?: string;   // 失败时的错误信息
}

interface SkillHit {
  skill_id: number;
  skill_name: string;
  skill_type: 1 | 2 | 3;        // 1必须 2优先 3普通
  is_hit: boolean;
  hit_context: string;           // 命中片段
  match_label?: string;          // 优秀/良好/一般/未达标
}
```

---

## 七、配色方案

| 用途 | 色值 |
|------|------|
| 主色(蓝色) | #2563EB |
| 辅助色(灰) | #64748B |
| 背景色 | #F8FAFC |
| 卡片背景 | #FFFFFF |
| 成功色(优秀) | #10B981 |
| 警告色(一般) | #F59E0B |
| 危险色(未达标) | #EF4444 |
| 文字主色 | #1E293B |
| 文字次色 | #64748B |

---

## 八、实现优先级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| P0 | 岗位管理（CRUD） | 基础功能 |
| P0 | 简历库 + 预览 | 评估依赖简历数据 |
| P0 | 评估管理（Celery异步） | 核心功能 |
| P1 | 投递管理 | 业务闭环 |
| P1 | 工作台（真实数据） | 数据统计 |
| P2 | 可视化报表 | 可复用评估数据 |

---

## 九、实现说明

### 9.1 Celery 任务队列配置

**Broker**: Redis (`redis://localhost:6379/1`)
**Backend**: Redis (`redis://localhost:6379/2`)
**Queue**: `eval`（评估队列）

### 9.2 任务注册

```python
# celery_app/tasks/eval_task.py
@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=2,
    autoretry_for=(LLMTimeoutError, RateLimitError, NetworkError),
    retry_backoff=2,  # 指数退避：2s, 4s, 8s
    retry_backoff_max=10,
)
def eval_batch_task(self, resume_ids: list, job_id: int):
    # 评估逻辑
    pass
```

### 9.3 兜底方案实现

```python
try:
    # 评估逻辑
    result = await evaluate_resume(resume_id, job_id)
except Exception as exc:
    if self.request.retries >= self.max_retries:
        # 记录失败状态
        await mark_evaluation_failed(resume_id, job_id, str(exc))
        raise Ignore()  # 不再重试
    raise self.retry(exc=exc)
```

### 9.4 简历文件预览实现

**Word 文档处理**：
```python
# backend/app/utils/storage/file_parser.py
from docx import Document

def extract_text_from_docx(file_path: str) -> str:
    """提取 Word 文档文本内容"""
    doc = Document(file_path)
    paragraphs = [p.text for p in doc.paragraphs]
    return "\n".join(paragraphs)
```

**文件类型检测**：
```python
import mimetypes

def get_file_type(file_path: str) -> str:
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type:
        if 'pdf' in mime_type:
            return 'pdf'
        elif 'word' in mime_type or 'document' in mime_type:
            return 'docx'
        elif 'image' in mime_type:
            return 'image'
    return 'unknown'
```

**预览 API 响应**：
```python
@router.get("/{resume_id}/file")
async def get_resume_file(resume_id: int, ...):
    resume = await get_resume(resume_id)
    file_type = get_file_type(resume.file_path)

    if file_type == 'docx':
        # Word 文件：提取文本返回
        text = extract_text_from_docx(resume.file_path)
        return {"file_type": "docx", "content": text}
    else:
        # PDF/图片：返回文件流
        return FileResponse(resume.file_path, media_type=get_mime_type(resume.file_path))
```

---

## 十、待确认事项

1. **部门数据隔离**：HR 角色如何确定「本部门」？是否需要新增 `sys_dept_employee` 的查询逻辑？
2. **权限标识**：各菜单/按钮的 `perm` 字段值需要定义，例如 `job:create`, `evaluation:batch` 等。
3. **简历预览文件路径**：本地存储路径如何映射到可访问的 URL？
