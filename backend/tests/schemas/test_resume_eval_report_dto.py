"""ResumeEvaluationReportDTO 扩展字段解析测试。"""

from app.schemas.agent.dto import ResumeEvaluationReportDTO


def test_report_dto_accepts_new_fields():
    """方案 B 扩展字段（画像/维度详情/面试建议/综合评语）可正确解析。"""
    data = {
        "final_score": 82,
        "final_label": "良好",
        "decision": "建议进入面试",
        "summary": "匹配度高",
        "match_overview": {"advantages": ["经验丰富"], "risks": ["跳槽频繁"]},
        "resume_structure": {},
        "experience_timeline": [],
        "skill_dimensions": [{
            "dimension_name": "技术深度",
            "score": 85,
            "weight": 0.3,
            "matched_skills": ["Python", "FastAPI"],
            "comment": "核心项目扎实",
            "advantage": "强",
            "disadvantage": "",
        }],
        "job_gaps": [{"gap": "缺管理", "suggestion": "面试考察"}],
        "profile_summary": {"years": 5, "education": "本科", "stack": ["Python"], "stability": "稳定"},
        "interview_suggestions": [{"focus": "系统设计", "reason": "岗位核心"}],
        "comprehensive_comment": {"advantages": "技术强", "risks": "管理弱"},
    }
    r = ResumeEvaluationReportDTO.model_validate(data)
    assert r.profile_summary["years"] == 5
    assert r.skill_dimensions[0]["matched_skills"] == ["Python", "FastAPI"]
    assert r.interview_suggestions[0]["focus"] == "系统设计"
    assert r.comprehensive_comment["advantages"] == "技术强"


def test_report_dto_defaults_new_fields_when_absent():
    """旧格式（缺新字段）也能解析，新字段回退默认空值，保证向后兼容。"""
    data = {
        "final_score": 70,
        "final_label": "一般",
        "decision": "建议人工复核",
        "summary": "尚可",
    }
    r = ResumeEvaluationReportDTO.model_validate(data)
    assert r.profile_summary == {}
    assert r.interview_suggestions == []
    assert r.comprehensive_comment == {}
