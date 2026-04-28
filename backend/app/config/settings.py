from functools import lru_cache
import logging
from pathlib import Path
from urllib.parse import quote

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    APP_NAME: str = "Resume Platform"
    DEBUG: bool = False
    LOGGING_LEVEL: str = "DEBUG"
    SECRET_KEY: SecretStr
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DB_HOST: str
    DB_PORT: int = 3306
    DB_USER: str
    DB_PASSWORD: SecretStr
    DB_NAME: str

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: SecretStr = SecretStr("")

    LITELLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: SecretStr
    OPENAI_API_BASE: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    FALLBACK_MODEL: str = "gpt-3.5-turbo"

    STORAGE_TYPE: str = "LOCAL"
    LOCAL_STORAGE_PATH: str = "./note"

    SMTP_HOST: str
    SMTP_PORT: int = 587
    SMTP_USER: str
    SMTP_PASSWORD: SecretStr
    EMAIL_FROM: str

    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""

    @property
    def secret_key(self) -> str:
        return self.SECRET_KEY.get_secret_value()

    @property
    def db_password(self) -> str:
        return self.DB_PASSWORD.get_secret_value()

    @property
    def redis_password(self) -> str:
        return self.REDIS_PASSWORD.get_secret_value()

    @property
    def openai_api_key(self) -> str:
        return self.OPENAI_API_KEY.get_secret_value()

    @property
    def smtp_password(self) -> str:
        return self.SMTP_PASSWORD.get_secret_value()

    @property
    def database_url(self) -> str:
        return f"mysql+aiomysql://{self.DB_USER}:{self.db_password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def redis_url(self) -> str:
        return self._build_redis_url(self.REDIS_DB)

    def _build_redis_url(self, db: int) -> str:
        if self.redis_password:
            password = quote(self.redis_password, safe="")
            return f"redis://:{password}@{self.REDIS_HOST}:{self.REDIS_PORT}/{db}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{db}"

    @property
    def celery_broker_url(self) -> str:
        return self.CELERY_BROKER_URL or self._build_redis_url(1)

    @property
    def celery_result_backend(self) -> str:
        return self.CELERY_RESULT_BACKEND or self._build_redis_url(2)

    @property
    def logging_level_value(self) -> int:
        level = logging.getLevelName(self.LOGGING_LEVEL.upper())
        if isinstance(level, int):
            return level
        return logging.DEBUG


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def configure_logging(settings: Settings | None = None) -> None:
    target_settings = settings or get_settings()
    logging.basicConfig(level=target_settings.logging_level_value)
    logging.getLogger().setLevel(target_settings.logging_level_value)
