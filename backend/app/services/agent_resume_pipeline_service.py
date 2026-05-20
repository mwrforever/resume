"""Agent 会话简历链路：上传、上下文加载、工具解析、Agent 整理 Markdown。"""



import logging

import os

from pathlib import Path



from fastapi import UploadFile



from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError

from app.llm.model_router import LLMModelRouter

from app.llm.prompts.manager import prompt_manager

from app.repositories.job_repository import JobRepository

from app.repositories.resume_repository import ResumeRepository

from app.schemas.agent.dto import LLMRuntimeConfigDTO

from app.schemas.agent.orchestrator_state import ResumeContextDTO

from app.utils.storage.registry import StorageRegistry



logger = logging.getLogger(__name__)





class AgentResumePipelineService:

    """员工 Agent 简历处理服务（供编排节点与上传 API 复用）。"""



    def __init__(

        self,

        resume_repo: ResumeRepository,

        job_repo: JobRepository,

    ) -> None:

        self._resume_repo = resume_repo

        self._job_repo = job_repo

        self._storage = StorageRegistry.get()



    async def upload_resume_for_employee(self, employee_id: int, file: UploadFile) -> dict:

        """

        员工在 Agent 会话中上传候选人简历（PDF/DOCX），仅落库文件。



        文本抽取在编排图 resume_extract 节点通过内置工具 parse_resume_file 完成。

        """

        allowed_extensions = [".pdf", ".docx"]

        ext = os.path.splitext(file.filename or "")[1].lower()

        if ext not in allowed_extensions:

            raise ValidationError("只支持 PDF 或 DOCX 格式")



        file_path = await self._storage.upload(file)

        resume = await self._resume_repo.create(

            user_id=employee_id,

            file_name=file.filename or "unknown",

            file_path=file_path,

            storage_type=self._storage.__class__.__name__,

            raw_text="",

        )

        logger.info(

            "Agent 简历上传成功：employee_id=%s resume_id=%s file_name=%s",

            employee_id,

            resume.id,

            resume.file_name,

        )

        return {"resume_id": resume.id, "file_name": resume.file_name}



    async def ensure_job_owned_by_employee(self, job_id: int, employee_id: int) -> None:

        """校验岗位归属当前员工（会话上下文绑定岗位）。"""

        job = await self._job_repo.get_by_id(job_id)

        if not job:

            raise NotFoundError("岗位不存在")

        if int(job.employee_id) != int(employee_id):

            raise ForbiddenError("无权访问该岗位")



    async def load_resume_context(

        self,

        resume_id: int,

        job_id: int,

        employee_id: int,

    ) -> ResumeContextDTO:

        """加载简历记录与文件路径，并校验岗位归属。"""

        await self.ensure_job_owned_by_employee(job_id, employee_id)

        resume = await self._resume_repo.get_by_id(resume_id)

        if not resume:

            raise NotFoundError("简历不存在")



        return ResumeContextDTO(

            resume_id=resume_id,

            job_id=job_id,

            file_name=resume.file_name,

            file_path=resume.file_path,

            raw_text=(resume.raw_text or "").strip(),

        )



    async def persist_raw_text(self, resume_id: int, raw_text: str) -> None:

        """工具解析成功后回写原文，便于后续复用。"""

        if raw_text.strip():

            await self._resume_repo.update_raw_text(resume_id, raw_text)



    async def format_structured_markdown(

        self,

        raw_text: str,

        runtime_config: LLMRuntimeConfigDTO,

        model_router: LLMModelRouter,

    ) -> str:

        """调用 LLM 将简历原文整理为 Markdown 结构化内容。"""

        prompt = prompt_manager.render("resume_structure_parse", resume_text=raw_text[:120000])

        result = await model_router.complete(prompt, runtime_config)

        content = (result.content or "").strip()

        if not content:

            raise ValidationError("简历 Markdown 整理未返回有效内容")

        return content



    @staticmethod

    def parse_resume_context_ref(context_refs: list[dict]) -> ResumeContextDTO | None:

        """

        从消息 context_refs 解析简历附件引用。



        约定：{"type": "resume", "resume_id": int, "job_id": int}

        """

        for ref in context_refs or []:

            if str(ref.get("type") or "").lower() != "resume":

                continue

            resume_id = ref.get("resume_id")

            job_id = ref.get("job_id")

            if resume_id is None or job_id is None:

                raise ValidationError("简历附件缺少 resume_id 或 job_id")

            return ResumeContextDTO(

                resume_id=int(resume_id),

                job_id=int(job_id),

                file_name=str(ref.get("file_name") or ""),

            )

        return None



    @staticmethod

    def resolve_resume_file_path(file_path: str) -> Path:

        """将存储相对路径转为本地绝对路径，供内置工具解析。"""

        storage = StorageRegistry.get()

        return Path(storage.get_full_path(file_path))


