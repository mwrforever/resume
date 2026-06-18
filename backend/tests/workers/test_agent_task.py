"""
agent_task 模块单元测试。

只覆盖纯函数：默认标题规则、默认态识别、后处理。
LLM 调用与 DB 双重校验依赖外部资源，由集成测试覆盖。
"""
from __future__ import annotations

import pytest

from app.workers.tasks.agent_task import (
    TITLE_MAX_LEN,
    _is_default_title,
    _make_default_title,
    _post_process,
)


class TestMakeDefaultTitle:
    """默认标题规则必须与 AgentRuntimeService._make_title_from_content 完全一致。"""

    def test_empty_returns_empty(self):
        assert _make_default_title("") == ""

    def test_strip_and_collapse_whitespace(self):
        assert _make_default_title("  hello   world  ") == "hello world"

    def test_replace_newline_and_tab(self):
        assert _make_default_title("a\nb\tc\rd") == "a b c d"

    def test_truncate_to_80_chars(self):
        content = "我" * 100
        assert _make_default_title(content) == "我" * 80

    def test_chinese_short_passes_through(self):
        assert _make_default_title("帮我评估候选人") == "帮我评估候选人"


class TestIsDefaultTitle:
    """默认态识别：占位符 / 用户问题截断态 → True；用户手动改过 → False。"""

    @pytest.mark.parametrize("placeholder", ["", "  ", "新会话", "未命名会话"])
    def test_placeholder_is_default(self, placeholder):
        assert _is_default_title(placeholder, "任意内容") is True

    def test_truncated_user_content_is_default(self):
        content = "帮我评估这份候选人简历，重点看技术能力"
        assert _is_default_title(content, content) is True

    def test_long_content_truncated_to_80_is_default(self):
        content = "很长的问题" * 40
        truncated = _make_default_title(content)
        assert _is_default_title(truncated, content) is True

    def test_user_modified_title_is_not_default(self):
        assert _is_default_title("我自己起的标题", "原始问题内容") is False

    def test_none_treated_as_empty_default(self):
        assert _is_default_title(None, "原始问题") is True


class TestPostProcess:
    """LLM 输出兜底清洗：去首尾标点 → 合并内部空白 → 截 20 字。"""

    def test_empty_input(self):
        assert _post_process("") == ""

    def test_strip_chinese_punctuation(self):
        assert _post_process("，候选人技术能力评估。") == "候选人技术能力评估"

    def test_strip_english_punctuation_and_quotes(self):
        assert _post_process('"Resume Analysis."') == "Resume Analysis"

    def test_collapse_internal_whitespace(self):
        assert _post_process("候选人 技术 评估") == "候选人技术评估"

    def test_truncate_to_max_len(self):
        raw = "候" * 30
        assert _post_process(raw) == "候" * TITLE_MAX_LEN

    def test_strip_then_truncate(self):
        raw = "  ， " + "评估" * 15 + "  。 "
        result = _post_process(raw)
        assert len(result) == TITLE_MAX_LEN
        assert not result.startswith(("，", " "))
        assert not result.endswith(("。", " "))
