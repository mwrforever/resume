from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    # App
    APP_NAME: str = "Resume Platform"
    DEBUG: bool = False
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    DB_HOST: str
    DB_PORT: int = 3306
    DB_USER: str
    DB_PASSWORD: str
    DB_NAME: str

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    # LiteLLM
    LITELLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str
    OPENAI_API_BASE: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    FALLBACK_MODEL: str = "gpt-3.5-turbo"

    # Storage
    STORAGE_TYPE: str = "LOCAL"
    LOCAL_STORAGE_PATH: str = "./note"

    # Email
    SMTP_HOST: str
    SMTP_PORT: int = 587
    SMTP_USER: str
    SMTP_PASSWORD: str
    EMAIL_FROM: str

    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""

    # Properties
    @property
    def database_url(self) -> str:
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def redis_url(self) -> str:
        return self._build_redis_url(self.REDIS_DB)

    def _build_redis_url(self, db: int) -> str:
        if self.REDIS_PASSWORD:
            password = quote(self.REDIS_PASSWORD, safe="")
            return f"redis://:{password}@{self.REDIS_HOST}:{self.REDIS_PORT}/{db}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{db}"

    @property
    def celery_broker_url(self) -> str:
        return self.CELERY_BROKER_URL or self._build_redis_url(1)

    @property
    def celery_result_backend(self) -> str:
        return self.CELERY_RESULT_BACKEND or self._build_redis_url(2)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
