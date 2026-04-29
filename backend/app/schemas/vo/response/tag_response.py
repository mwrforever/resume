from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class TagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    sort_order: int = 0
    status: int = 1
    color: str

    model_config = ConfigDict(from_attributes=True)


