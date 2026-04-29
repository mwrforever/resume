import pytest
import pytest_asyncio
import time
import redis
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.models import Base
from app.utils.security import create_access_token
from app.infrastructure.config import get_settings


settings = get_settings()
TEST_DATABASE_URL = f"mysql+aiomysql://{settings.DB_USER}:{settings.db_password}@{settings.DB_HOST}:{settings.DB_PORT}/resume_test"


async def _ensure_test_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        job_template_column = await conn.execute(text("SHOW COLUMNS FROM job_position LIKE 'template_id'"))
        if not job_template_column.first():
            await conn.execute(text("ALTER TABLE job_position ADD COLUMN template_id BIGINT DEFAULT NULL AFTER dept_id"))
            await conn.execute(text("ALTER TABLE job_position ADD INDEX idx_template_status (template_id, status)"))
        application_snapshot_column = await conn.execute(text("SHOW COLUMNS FROM job_application LIKE 'job_snapshot'"))
        if not application_snapshot_column.first():
            await conn.execute(text("ALTER TABLE job_application ADD COLUMN job_snapshot JSON AFTER status"))
        match_application_column = await conn.execute(text("SHOW COLUMNS FROM resume_job_match LIKE 'application_id'"))
        if not match_application_column.first():
            await conn.execute(text("ALTER TABLE resume_job_match ADD COLUMN application_id BIGINT DEFAULT NULL AFTER id"))
            await conn.execute(text("ALTER TABLE resume_job_match ADD UNIQUE KEY uk_application (application_id)"))
        match_error_column = await conn.execute(text("SHOW COLUMNS FROM resume_job_match LIKE 'error_message'"))
        if not match_error_column.first():
            await conn.execute(text("ALTER TABLE resume_job_match ADD COLUMN error_message VARCHAR(500) DEFAULT NULL AFTER is_direct_preferred"))


@pytest_asyncio.fixture(scope="function")
async def client():
    """Create async test client with proper cleanup"""
    from app.infrastructure.client import get_db

    engine = create_async_engine(TEST_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=5, max_overflow=0)
    await _ensure_test_schema(engine)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_maker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
def user_token() -> str:
    return create_access_token(data={"sub": "1", "type": "user"})


@pytest.fixture
def employee_token() -> str:
    return create_access_token(data={"sub": "1", "type": "employee"})


@pytest.fixture
def user_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def employee_headers(employee_token: str) -> dict:
    return {"Authorization": f"Bearer {employee_token}"}


@pytest.fixture
def employee2_token() -> str:
    return create_access_token(data={"sub": "2", "type": "employee"})


@pytest.fixture
def employee2_headers(employee2_token: str) -> dict:
    return {"Authorization": f"Bearer {employee2_token}"}


@pytest.fixture(scope="function")
def redis_client() -> redis.Redis:
    client = redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_DB,
        password=settings.redis_password or None,
        decode_responses=True
    )
    yield client
    try:
        client.flushdb()
    except Exception:
        pass
    client.close()


@pytest.fixture(scope="function")
def unique_email() -> str:
    return f"test_{int(time.time() * 1000000)}@example.com"


@pytest.fixture(scope="function")
def unique_emp_no() -> str:
    return f"EMP{int(time.time() * 1000000)}"
