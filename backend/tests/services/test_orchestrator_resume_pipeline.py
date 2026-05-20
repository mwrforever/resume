"""简历编排链路单元测试：context_refs 解析、内置工具、Analyst 合并、图路由。"""



import pytest



from app.core.exceptions import ValidationError

from app.llm.graphs.nodes.analyst import analyst_node

from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph

from app.llm.tools.builtin import builtin_agent_tools

from app.schemas.agent.dto import AgentToolCallDTO, LLMRuntimeConfigDTO

from app.schemas.agent.orchestrator_state import OrchestratorState, ResumeContextDTO

from app.services.agent_resume_pipeline_service import AgentResumePipelineService





def _runtime() -> LLMRuntimeConfigDTO:

    return LLMRuntimeConfigDTO(

        model_name="test-model",

        api_key="secret",

        base_url="http://localhost",

        enable_tools=False,

    )





def test_parse_resume_context_ref_requires_job_id():

    with pytest.raises(ValidationError):

        AgentResumePipelineService.parse_resume_context_ref(

            [{"type": "resume", "resume_id": 1}],

        )





def test_parse_resume_context_ref_ok():

    ctx = AgentResumePipelineService.parse_resume_context_ref(

        [{"type": "resume", "resume_id": 10, "job_id": 20, "file_name": "a.pdf"}],

    )

    assert ctx is not None

    assert ctx.resume_id == 10

    assert ctx.job_id == 20





@pytest.mark.asyncio

async def test_analyst_merges_resume_when_ready():

    state = OrchestratorState(

        session_id=1,

        session_key="sk-resume",

        employee_id=1,

        user_input="请总结亮点",

        prompt="请总结亮点",

        runtime_config=_runtime(),

        has_resume_attachment=True,

        resume_context=ResumeContextDTO(

            resume_id=1,

            job_id=2,

            file_name="r.pdf",

            file_path="uploads/r.pdf",

            raw_text="张三，三年 Java 经验",

            structured_markdown="## 工作经历\n- 某公司 Java 开发",

        ),

    )

    result = await analyst_node(state)

    assert result["analysis_ready"] is True

    assert "结构化简历" in result["prompt"]

    assert "用户指令" in result["prompt"]

    assert "岗位评估" not in result["prompt"]





def test_graph_entry_routes_resume_prepare():

    graph = AgentOrchestratorGraph(resume_pipeline=object())

    state = OrchestratorState(

        session_id=1,

        session_key="sk",

        employee_id=1,

        user_input="hi",

        runtime_config=_runtime(),

        has_resume_attachment=True,

        resume_context=ResumeContextDTO(resume_id=1, job_id=2, file_path="x.pdf"),

    )

    assert graph._route_entry(state) == "resume_prepare"





def test_graph_routes_extract_to_markdown_to_analyst():

    graph = AgentOrchestratorGraph(resume_pipeline=object())

    ok_state = OrchestratorState(

        session_id=1,

        session_key="sk",

        employee_id=1,

        user_input="hi",

        runtime_config=_runtime(),

    )

    assert graph._route_after_resume_prepare(ok_state) == "resume_extract"

    assert graph._route_after_resume_extract(ok_state) == "resume_markdown"

    assert graph._route_after_resume_markdown(ok_state) == "analyst"





def test_graph_failure_routes_to_reporter():

    graph = AgentOrchestratorGraph(resume_pipeline=object())

    state = OrchestratorState(

        session_id=1,

        session_key="sk",

        employee_id=1,

        user_input="hi",

        runtime_config=_runtime(),

        error_message="简历解析失败",

    )

    assert graph._route_after_resume_extract(state) == "reporter"





def test_parse_resume_file_tool_missing_path():

    result = builtin_agent_tools.execute(

        AgentToolCallDTO(

            tool_name="parse_resume_file",

            display_name="解析简历",

            input_payload={"resume_id": 1},

        ),

        {},

    )

    assert result.success is False


