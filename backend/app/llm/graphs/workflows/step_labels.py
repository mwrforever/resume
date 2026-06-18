"""节点名 → 中文友好提示映射。

runner 翻译 LangGraph updates 时用此映射生成 step.update 的 title / detail，
让前端步骤条显示"正在并行生成各维度题目…"而不是英文节点名
fanout_generate_questions。

注意：LangGraph stream_mode="updates" 在节点**完成产出后**才触发，
所以语义上 status 仍标 success（节点已产出），但 detail 用 running_detail
表达"该步骤已在工作"。前端把 steps 数组最后一个 success step 视为当前
活跃步骤做波浪动画。
"""

from __future__ import annotations

# 映射值：(title, running_detail, success_detail)
STEP_LABELS: dict[str, tuple[str, str, str]] = {
    # 图一：简历问答
    "load_resume": (
        "读取简历", "正在解析简历内容…", "简历解析完成",
    ),
    "suggest_dimensions": (
        "分析维度", "正在结合岗位需求分析考察维度…", "维度分析完成",
    ),
    "request_dimension_selection": (
        "选择维度", "等待选择考察维度…", "维度已确认",
    ),
    "build_question_plan": (
        "规划出题", "正在收集需求并规划出题…", "出题方案已生成",
    ),
    "request_plan_approval": (
        "确认计划", "等待确认出题计划…", "计划已确认",
    ),
    "fanout_generate_questions": (
        "生成题目", "正在并行生成各维度题目…", "题目生成完成",
    ),
    "reduce_questions": (
        "汇总整理", "正在汇总去重…", "汇总完成",
    ),
    "finalize_question_set": (
        "输出题库", "正在整理最终题库…", "题库已就绪",
    ),
    # 图二：简历评估
    "analyze_resume_profile": (
        "分析画像", "正在结构化解析简历…", "画像分析完成",
    ),
    "load_job_candidates": (
        "加载岗位", "正在加载候选岗位…", "岗位加载完成",
    ),
    "request_job_selection": (
        "选择岗位", "等待选择岗位…", "岗位已选择",
    ),
    "validate_job_full_name": (
        "校验岗位", "正在校验岗位归属…", "岗位校验通过",
    ),
    "run_evaluation_subgraph": (
        "多维评估", "正在进行多维度评估…", "评估完成",
    ),
    "build_visualization_report": (
        "组装报告", "正在组装可视化报告…", "报告已生成",
    ),
    "finalize_evaluation_report": (
        "输出报告", "正在整理评估报告…", "报告已就绪",
    ),
}

DEFAULT_LABEL: tuple[str, str, str] = ("处理中", "正在处理…", "完成")


def get_step_label(node_name: str) -> tuple[str, str, str]:
    """获取节点中文提示三元组，未知节点返回默认。

    @param node_name - LangGraph 节点名（如 "fanout_generate_questions"）
    @return (title, running_detail, success_detail) 三元组
    """
    return STEP_LABELS.get(str(node_name), DEFAULT_LABEL)
