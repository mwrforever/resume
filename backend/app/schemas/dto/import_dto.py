from pydantic import BaseModel


class ImportErrorDTO(BaseModel):
    line: int
    message: str


class ImportResultDTO(BaseModel):
    success_count: int
    fail_count: int
    errors: list[ImportErrorDTO]
