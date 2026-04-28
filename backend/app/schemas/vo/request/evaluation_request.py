from pydantic import BaseModel


class BatchEvalRequest(BaseModel):
    application_ids: list[int]
