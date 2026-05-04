from fastapi import FastAPI
from starlette.responses import JSONResponse


class BizError(Exception):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class UnauthorizedError(BizError):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(code=401, message=message)


class ForbiddenError(BizError):
    def __init__(self, message: str = "Forbidden"):
        super().__init__(code=403, message=message)


class NotFoundError(BizError):
    def __init__(self, message: str = "Not found"):
        super().__init__(code=404, message=message)


class ValidationError(BizError):
    def __init__(self, message: str = "Validation error"):
        super().__init__(code=422, message=message)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BizError)
    async def biz_error_handler(request, exc: BizError):
        return JSONResponse(
            status_code=exc.code,
            content={"code": exc.code, "message": exc.message, "data": None}
        )
