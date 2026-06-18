"""评估报告维度名兜底单测。"""

from app.services.resume_evaluation_service import _override_dimension_names


def test_override_replaces_placeholder_by_dimension_id():
    """报告维度名占位（维度1）被评估结果的真实维度名按 dimension_id 覆盖。"""
    report = {
        "skill_dimensions": [
            {"dimension_id": 1, "dimension_name": "维度1", "score": 80},
            {"dimension_id": 2, "dimension_name": "技术深度", "score": 90},
        ]
    }
    eval_dims = [
        {"dimension_id": 1, "dimension_name": "沟通能力"},
        {"dimension_id": 2, "dimension_name": "技术深度"},
    ]
    _override_dimension_names(report, eval_dims)
    assert report["skill_dimensions"][0]["dimension_name"] == "沟通能力"
    assert report["skill_dimensions"][1]["dimension_name"] == "技术深度"


def test_override_placeholder_fallback_by_order_when_no_id():
    """报告项缺 dimension_id 且名为占位时，按列表顺序用评估结果真名覆盖。"""
    report = {
        "skill_dimensions": [
            {"dimension_name": "维度1"},
            {"dimension_name": "维度2"},
        ]
    }
    eval_dims = [
        {"dimension_id": 1, "dimension_name": "沟通能力"},
        {"dimension_id": 2, "dimension_name": "技术深度"},
    ]
    _override_dimension_names(report, eval_dims)
    assert report["skill_dimensions"][0]["dimension_name"] == "沟通能力"
    assert report["skill_dimensions"][1]["dimension_name"] == "技术深度"


def test_override_skips_when_no_eval_dims():
    """评估结果为空时不覆盖，保留 LLM 原名。"""
    report = {"skill_dimensions": [{"dimension_name": "维度1"}]}
    _override_dimension_names(report, [])
    assert report["skill_dimensions"][0]["dimension_name"] == "维度1"


def test_override_keeps_non_placeholder_name_without_id():
    """报告项有真实名（非占位）且无 id 时不被顺序兜底误覆盖。"""
    report = {
        "skill_dimensions": [
            {"dimension_name": "领导力"},  # 真实名，应保留
            {"dimension_name": "维度2"},  # 占位，应被覆盖
        ]
    }
    eval_dims = [
        {"dimension_id": 1, "dimension_name": "沟通能力"},
        {"dimension_id": 2, "dimension_name": "技术深度"},
    ]
    _override_dimension_names(report, eval_dims)
    assert report["skill_dimensions"][0]["dimension_name"] == "领导力"
    assert report["skill_dimensions"][1]["dimension_name"] == "沟通能力"
