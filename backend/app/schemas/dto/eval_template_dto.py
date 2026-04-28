from typing import Optional

from pydantic import BaseModel


class SnapshotJobDTO(BaseModel):
    id: int
    name: str
    description: str
    dept_id: int
    dept_name: Optional[str] = None
    dept_code: Optional[str] = None


class SnapshotTemplateDTO(BaseModel):
    id: int
    template_name: str


class JobSnapshotDTO(BaseModel):
    job: SnapshotJobDTO
    template: SnapshotTemplateDTO
    dimensions: list[dict]
    skills: list[dict]
    tags: list[dict]
    snapshot_time: str
