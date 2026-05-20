"""LangGraph 主编排图：InMemory Checkpoint/Store，thread_id 由调用方传入 session_key。"""



import logging

from functools import lru_cache

from typing import Any



from langgraph.checkpoint.memory import InMemorySaver

from langgraph.graph import END, StateGraph

from langgraph.store.memory import InMemoryStore

from langgraph.types import Command



from app.llm.graphs.nodes.analyst import analyst_node

from app.llm.graphs.nodes.legacy_executor import legacy_executor_node

from app.llm.graphs.nodes.planner import planner_node

from app.llm.graphs.nodes.reporter import reporter_node

from app.llm.graphs.nodes.resume_pipeline import (

    resume_extract_node,

    resume_markdown_node,

    resume_prepare_node,

)

from app.llm.graphs.nodes.supervisor import supervisor_node

from app.llm.model_router import LLMModelRouter, get_default_model_router

from app.schemas.agent.enums import AgentNodeId

from app.schemas.agent.orchestrator_state import OrchestratorState

from app.services.agent_resume_pipeline_service import AgentResumePipelineService



logger = logging.getLogger(__name__)





def build_graph_config(session_key: str) -> dict[str, Any]:

    """

    构建 LangGraph 运行配置。



    session_key 与 agent_session.session_key 一一对应，作为 thread_id 使用。

    """

    return {"configurable": {"thread_id": session_key}}





class AgentOrchestratorGraph:

    """Agent 编排图门面：封装 compile、astream 与 resume。"""



    def __init__(

        self,

        model_router: LLMModelRouter | None = None,

        resume_pipeline: AgentResumePipelineService | None = None,

    ) -> None:

        self._model_router = model_router or get_default_model_router()

        self._resume_pipeline = resume_pipeline

        self._graph = self._compile_graph()



    @property

    def compiled(self):

        return self._graph



    def _compile_graph(self):

        graph = StateGraph(OrchestratorState)



        graph.add_node(AgentNodeId.ANALYST.value, analyst_node)

        graph.add_node(AgentNodeId.PLANNER.value, self._bind_planner)

        graph.add_node(AgentNodeId.SUPERVISOR.value, supervisor_node)

        graph.add_node(AgentNodeId.LEGACY_EXECUTOR.value, self._bind_legacy_executor)

        graph.add_node(AgentNodeId.REPORTER.value, reporter_node)



        if self._resume_pipeline is not None:

            graph.add_node(AgentNodeId.RESUME_PREPARE.value, self._bind_resume_prepare)

            graph.add_node(AgentNodeId.RESUME_EXTRACT.value, self._bind_resume_extract)

            graph.add_node(AgentNodeId.RESUME_MARKDOWN.value, self._bind_resume_markdown)



            graph.set_conditional_entry_point(

                self._route_entry,

                {

                    AgentNodeId.RESUME_PREPARE.value: AgentNodeId.RESUME_PREPARE.value,

                    AgentNodeId.ANALYST.value: AgentNodeId.ANALYST.value,

                },

            )

            graph.add_conditional_edges(

                AgentNodeId.RESUME_PREPARE.value,

                self._route_after_resume_prepare,

                {

                    AgentNodeId.RESUME_EXTRACT.value: AgentNodeId.RESUME_EXTRACT.value,

                    AgentNodeId.REPORTER.value: AgentNodeId.REPORTER.value,

                },

            )

            graph.add_conditional_edges(

                AgentNodeId.RESUME_EXTRACT.value,

                self._route_after_resume_extract,

                {

                    AgentNodeId.RESUME_MARKDOWN.value: AgentNodeId.RESUME_MARKDOWN.value,

                    AgentNodeId.REPORTER.value: AgentNodeId.REPORTER.value,

                },

            )

            graph.add_conditional_edges(

                AgentNodeId.RESUME_MARKDOWN.value,

                self._route_after_resume_markdown,

                {

                    AgentNodeId.ANALYST.value: AgentNodeId.ANALYST.value,

                    AgentNodeId.REPORTER.value: AgentNodeId.REPORTER.value,

                },

            )

        else:

            graph.set_entry_point(AgentNodeId.ANALYST.value)



        graph.add_conditional_edges(

            AgentNodeId.ANALYST.value,

            self._route_after_analyst,

            {

                AgentNodeId.PLANNER.value: AgentNodeId.PLANNER.value,

                AgentNodeId.REPORTER.value: AgentNodeId.REPORTER.value,

            },

        )

        graph.add_edge(AgentNodeId.SUPERVISOR.value, AgentNodeId.LEGACY_EXECUTOR.value)

        graph.add_edge(AgentNodeId.LEGACY_EXECUTOR.value, AgentNodeId.REPORTER.value)

        graph.add_edge(AgentNodeId.REPORTER.value, END)



        checkpointer = get_shared_checkpointer()

        store = get_shared_store()

        return graph.compile(checkpointer=checkpointer, store=store)



    async def _bind_planner(self, state: OrchestratorState):

        return await planner_node(state, model_router=self._model_router)



    async def _bind_legacy_executor(self, state: OrchestratorState):

        return await legacy_executor_node(state, model_router=self._model_router)



    async def _bind_resume_prepare(self, state: OrchestratorState):

        return await resume_prepare_node(state, pipeline=self._resume_pipeline)



    async def _bind_resume_extract(self, state: OrchestratorState):

        return await resume_extract_node(state, pipeline=self._resume_pipeline)



    async def _bind_resume_markdown(self, state: OrchestratorState):

        return await resume_markdown_node(

            state,

            pipeline=self._resume_pipeline,

            model_router=self._model_router,

        )



    @staticmethod

    def _route_entry(state: OrchestratorState) -> str:

        if state.has_resume_attachment:

            return AgentNodeId.RESUME_PREPARE.value

        return AgentNodeId.ANALYST.value



    @staticmethod

    def _route_after_resume_prepare(state: OrchestratorState) -> str:

        if state.error_message:

            return AgentNodeId.REPORTER.value

        return AgentNodeId.RESUME_EXTRACT.value



    @staticmethod

    def _route_after_resume_extract(state: OrchestratorState) -> str:

        if state.error_message:

            return AgentNodeId.REPORTER.value

        return AgentNodeId.RESUME_MARKDOWN.value



    @staticmethod

    def _route_after_resume_markdown(state: OrchestratorState) -> str:

        if state.error_message:

            return AgentNodeId.REPORTER.value

        return AgentNodeId.ANALYST.value



    @staticmethod

    def _route_after_analyst(state: OrchestratorState) -> str:

        if state.analysis_ready:

            return AgentNodeId.PLANNER.value

        return AgentNodeId.REPORTER.value



    async def astream(

        self,

        initial_state: OrchestratorState,

        *,

        session_key: str,

        stream_mode: str | list[str] = "updates",

    ):

        """流式执行编排图，thread_id=session_key。"""

        config = build_graph_config(session_key)

        logger.info("编排图流式启动：thread_id=%s has_resume=%s", session_key, initial_state.has_resume_attachment)

        async for chunk in self._graph.astream(initial_state, config=config, stream_mode=stream_mode):

            yield chunk



    async def astream_resume(

        self,

        resume_payload: dict[str, Any],

        *,

        session_key: str,

        stream_mode: str | list[str] = "updates",

    ):

        """从 interrupt 恢复，resume 值进入 planner interrupt() 返回。"""

        config = build_graph_config(session_key)

        logger.info("编排图恢复执行：thread_id=%s", session_key)

        async for chunk in self._graph.astream(

            Command(resume=resume_payload),

            config=config,

            stream_mode=stream_mode,

        ):

            yield chunk



    async def get_state(self, session_key: str) -> Any:

        """读取 checkpoint 中的当前状态（用于判断是否 interrupt）。"""

        config = build_graph_config(session_key)

        return await self._graph.aget_state(config)





@lru_cache(maxsize=1)

def get_shared_checkpointer() -> InMemorySaver:

    """进程内共享 InMemory Checkpoint。"""

    return InMemorySaver()





@lru_cache(maxsize=1)

def get_shared_store() -> InMemoryStore:

    """进程内共享 InMemory Store。"""

    return InMemoryStore()





@lru_cache(maxsize=1)

def get_default_orchestrator_graph() -> AgentOrchestratorGraph:

    """编排图单例（复用 checkpointer，保证同 session_key 可 resume）。"""

    return AgentOrchestratorGraph()


