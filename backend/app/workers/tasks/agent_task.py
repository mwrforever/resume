"""
Agent 相关异步任务集合。

当前任务：
- refine_session_title_task：基于用户首条问题异步精化会话标题（≤20 字、纯中文）
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from sqlalchemy import text

from app.llm.model_router import LLMModelRouter
from app.llm.prompts.manager import prompt_manager
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.workers.celery_app import celery_app
from app.workers.db import mysql_manager_sync

logger = logging.getLogger(__name__)

# 标题最大字数（中文字符按字符计）
TITLE_MAX_LEN = 20

# DB 默认占位标题集合：与 agent_runtime_service._make_title_from_content 上游保持一致
_DEFAULT_TITLES = {"", "新会话", "未命名会话"}

# 后处理：去除首尾常见标点（中英文）、引号、括号、空白
_STRIP_PUNCTUATION = re.compile(
    r"^[\s\"'` ,.;:!?，。；：！？、（）()【】\[\]\-—_]+"
    r"|[\s\"'` ,.;:!?，。；：！？、（）()【】\[\]\-—_]+$"
)

# 后处理：去除 CJK 字符之间的空格（保留英文词间空格）
_CJK_SPACE = re.compile(r"(?<=[一-鿿]) (?=[一-鿿])")


def _make_default_title(content: str) -> str:
    """与 AgentRuntimeService._make_title_from_content 完全一致的默认标题规则。

    保持单一事实源：上游规则一旦变更，本函数同步更新，单元测试守住一致性。

    @param content: 用户消息原文
    @return: 单行 ≤80 字的标题文本（与 AgentRuntimeService 上游规则、DB 列上限对齐）
    """
    if not content:
        return ""
    flat = content.strip().replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return " ".join(flat.split())[:80]


def _is_default_title(current: str | None, content: str) -> bool:
    """判断 DB 中的当前标题是否仍处于"默认态"。

    默认态包含：
    1. 空字符串、None、空白
    2. 占位符（"新会话"、"未命名会话"）
    3. 与上游 _make_title_from_content(content) 完全一致（即首次发送消息自动填的标题）

    若用户已手动改过标题（非以上任何一种），返回 False，跳过精化覆盖以保护用户意图。

    @param current: DB 中读出的当前 title
    @param content: 本次用户首条消息原文
    @return: True 表示仍为默认态，可以精化覆盖；False 表示已被用户修改，跳过
    """
    cur = (current or "").strip()
    if cur in _DEFAULT_TITLES:
        return True
    return cur == _make_default_title(content)


def _post_process(raw: str) -> str:
    """对 LLM 返回的标题做兜底清洗。

    规则：
    1. 去首尾空白
    2. 去首尾标点（中英文，引号、括号、句号、逗号、空格）
    3. 合并所有内部连续空白为单空格
    4. 去除 CJK 字符之间的空格（中文标题不需要空格分词，但保留英文词间空格）
    5. 截 20 字（中文按字符计）

    @param raw: LLM 原始输出
    @return: 清洗后的标题；可能为空字符串（表示放弃落库）
    """
    if not raw:
        return ""
    cleaned = _STRIP_PUNCTUATION.sub("", raw.strip())
    cleaned = " ".join(cleaned.split())
    cleaned = _CJK_SPACE.sub("", cleaned)
    return cleaned[:TITLE_MAX_LEN]


async def _arefine(content: str, runtime_config: LLMRuntimeConfigDTO) -> str:
    """异步调用 LLM 生成精化标题。

    标题生成不需要 fallback、不需要 thinking、不需要长输出：
    复制 runtime_config 后强制覆盖关键参数以降低成本和延迟。

    @param content: 用户首条问题原文
    @param runtime_config: 透传自前端发送时的运行时配置（含 model_name / api_key / base_url 等）
    @return: 后处理后的标题；空字符串表示放弃
    """
    prompt = prompt_manager.render("agent/title_refine", user_content=content)
    # 复制并强制覆盖：标题生成关闭 thinking、关闭 fallback；max_tokens 给足 8192
    # 避免 Qwen3 等思考型模型即便关 thinking 后正文仍被早期截断
    title_config = runtime_config.model_copy(update={
        "enable_thinking": False,
        "fallback_model_name": None,
        "max_tokens": 8192,
        "temperature": 0.3,
    })
    router = LLMModelRouter()
    result = await router.complete(prompt, title_config)
    return _post_process(getattr(result, "content", "") or "")


@celery_app.task(
    bind=True,
    name="app.workers.tasks.agent_task.refine_session_title_task",
    max_retries=0,                  # 不重试：失败 silent fallback 即可
    ignore_result=True,
)
def refine_session_title_task(
    self,
    session_id: int,
    user_content: str,
    runtime_config_dict: dict[str, Any],
) -> None:
    """异步精化会话标题。

    流程：
    1. 第一次双重校验：DB 当前 title 仍为默认态 → 才继续
    2. 调 LLM 生成 ≤20 字中文标题（asyncio.run 同步包装）
    3. 第二次双重校验后落库（避免与人工修改竞态）

    任何异常都仅记 warn 日志、不重试，保留默认标题作为兜底。

    @param session_id: AgentSession.id
    @param user_content: 用户首条消息原文
    @param runtime_config_dict: LLMRuntimeConfigDTO.model_dump(mode="json") 序列化后的字典
    """
    logger.info("开始精化会话标题：session_id=%s", session_id)
    try:
        # 1. 第一次双重校验：当前 title 是否仍为默认态
        with mysql_manager_sync.session() as db_session:
            row = db_session.execute(
                text("SELECT title FROM agent_session WHERE id = :sid AND status = 1"),
                {"sid": session_id},
            ).mappings().first()
        if not row:
            logger.warning("精化标题跳过：会话不存在 session_id=%s", session_id)
            return
        if not _is_default_title(row["title"], user_content):
            logger.info(
                "精化标题跳过：当前标题已被用户手动修改 session_id=%s title=%s",
                session_id, row["title"],
            )
            return

        # 2. 调 LLM
        runtime_config = LLMRuntimeConfigDTO(**runtime_config_dict)
        refined = asyncio.run(_arefine(user_content, runtime_config))
        if not refined:
            logger.warning("精化标题跳过：LLM 返回空 session_id=%s", session_id)
            return

        # 3. 原子条件 UPDATE：把"第二次默认态校验 + 写入"压缩为一条 SQL，
        #    彻底消除两次 SELECT 之间用户手动改标题的覆盖窗口。
        #    匹配条件包含：占位标题、空、与本次首条问题截断态完全一致。
        #    status=1 是 agent_session 的正常态（status=0 视为软删除，参考 soft_delete_session）。
        expected_default = _make_default_title(user_content)
        with mysql_manager_sync.session() as db_session:
            result = db_session.execute(
                text(
                    "UPDATE agent_session SET title = :title "
                    "WHERE id = :sid AND status = 1 AND ("
                    "title IS NULL OR TRIM(title) = '' "
                    "OR title IN ('新会话', '未命名会话') "
                    "OR title = :expected_default"
                    ")"
                ),
                {
                    "title": refined,
                    "sid": session_id,
                    "expected_default": expected_default,
                },
            )
            db_session.commit()
        if result.rowcount == 0:
            logger.info(
                "精化标题落库前竞态保护：标题已被用户修改 session_id=%s", session_id,
            )
            return
        logger.info("会话标题精化完成：session_id=%s title=%s", session_id, refined)
    except Exception as exc:
        # 任何异常都不抛、不重试：保留默认标题
        logger.warning("会话标题精化失败（忽略）：session_id=%s err=%s", session_id, exc)
