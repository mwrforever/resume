"""需求分析节点：合并用户输入与简历 Markdown，决定是否进入规划。"""



import logging



from app.schemas.agent.orchestrator_state import OrchestratorState



logger = logging.getLogger(__name__)





async def analyst_node(state: OrchestratorState) -> dict:

    """

    分析用户输入与简历上下文是否足以进入规划。



    - 纯文本：非空 user_input 即可规划

    - 含简历附件：需完成工具解析 + Markdown 整理，且 user_input 非空

    """

    has_input = bool(state.user_input.strip())

    resume_ctx = state.resume_context



    if state.has_resume_attachment:

        if not resume_ctx or not resume_ctx.structured_markdown.strip():

            return {

                "analysis_ready": False,

                "analysis_summary": "简历尚未完成 Markdown 结构化整理。",

                "error_message": "简历整理未完成，无法继续分析",

            }

        if not resume_ctx.raw_text.strip():

            return {

                "analysis_ready": False,

                "analysis_summary": "简历原文尚未通过工具解析。",

                "error_message": "简历解析未完成，无法继续分析",

            }

        if not has_input:

            return {

                "analysis_ready": False,

                "analysis_summary": "请补充您希望 Agent 协助的问题或指令（例如：总结亮点、给出面试建议）。",

                "error_message": "请填写消息内容",

            }



        summary = "已完成简历解析与 Markdown 整理，将结合您的指令进入规划。"

        enriched_prompt = _build_prompt_with_resume(state.prompt or state.user_input, resume_ctx)

        logger.info(

            "需求分析完成（含简历）：session_key=%s resume_id=%s job_id=%s",

            state.session_key,

            resume_ctx.resume_id,

            resume_ctx.job_id,

        )

        return {

            "analysis_ready": True,

            "analysis_summary": summary,

            "prompt": enriched_prompt,

            "error_message": None,

        }



    ready = has_input

    summary = "用户需求已记录，进入规划阶段。" if ready else "用户输入为空，无法继续。"

    logger.info(

        "需求分析节点完成：session_key=%s analysis_ready=%s",

        state.session_key,

        ready,

    )

    return {

        "analysis_ready": ready,

        "analysis_summary": summary,

        "error_message": None if ready else "用户输入不能为空",

    }





def _build_prompt_with_resume(prompt: str, resume_ctx) -> str:

    """把结构化简历 Markdown 拼入 Planner 可见的 prompt。"""

    sections = [

        "## 用户指令",

        prompt.strip(),

        "## 结构化简历（Markdown）",

        resume_ctx.structured_markdown.strip(),

    ]

    return "\n\n".join(sections)


