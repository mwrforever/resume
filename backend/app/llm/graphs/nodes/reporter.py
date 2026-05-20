"""总结节点：整理最终输出（首版透传 legacy_executor 结果）。"""



import logging



from app.schemas.agent.orchestrator_state import OrchestratorState



logger = logging.getLogger(__name__)





async def reporter_node(state: OrchestratorState) -> dict:

    """将 final_content 固化为报告文本。"""

    content = state.final_content or state.error_message or "未能生成回复，请稍后重试。"

    logger.info("总结节点完成：session_key=%s content_length=%s", state.session_key, len(content))

    return {"final_content": content}


