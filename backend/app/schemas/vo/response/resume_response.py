from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class BaseItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ResumeItem(BaseItem):
    id: int
    file_name: str
    status: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    create_time: Optional[datetime] = None


class ResumeDetail(ResumeItem):
    file_path: str


