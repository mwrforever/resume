from typing import Optional

from pydantic import BaseModel


class DeptCreate(BaseModel):
    parent_id: int = 0
    dept_code: str
    dept_name: str
    leader_id: Optional[int] = None
    sort_order: int = 0
    status: int = 1


class DeptUpdate(BaseModel):
    parent_id: Optional[int] = None
    dept_code: Optional[str] = None
    dept_name: Optional[str] = None
    leader_id: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[int] = None
