import pytest
import pytest_asyncio
import asyncio
import time
import redis
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.models import Base
from app.core.security import create_access_token
from app.core.config import get_settings


settings = get_settings()
TEST_DATABASE_URL = f"mysql+aiomysql://{settings.DB_USER}:{settings.DB_PASSWORD}@{settings.DB_HOST}:{settings.DB_PORT}/resume_test"


@pytest_asyncio.fixture(scope="function")
async def client():
    """Create async test client with proper cleanup"""
    from app.api.deps import get_db

    engine = create_async_engine(TEST_DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=5, max_overflow=0)
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
def user_token():
    """Create a valid user token"""
    return create_access_token(data={"sub": "1", "type": "user"})


@pytest.fixture
def employee_token():
    """Create a valid employee token"""
    return create_access_token(data={"sub": "1", "type": "employee"})


@pytest.fixture
def user_headers(user_token):
    """Headers with user token"""
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def employee_headers(employee_token):
    """Headers with employee token"""
    return {"Authorization": f"Bearer {employee_token}"}


@pytest.fixture
def employee2_token():
    """Create token for second employee (for isolation tests)"""
    return create_access_token(data={"sub": "2", "type": "employee"})


@pytest.fixture
def employee2_headers(employee2_token):
    """Headers with second employee token"""
    return {"Authorization": f"Bearer {employee2_token}"}


@pytest.fixture(scope="function")
def redis_client():
    """Create a Redis client for tests with cleanup."""
    client = redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_DB,
        password=settings.REDIS_PASSWORD or None,
        decode_responses=True
    )
    yield client
    try:
        client.flushdb()
    except Exception:
        pass
    client.close()


@pytest.fixture(scope="function")
def unique_email():
    """Generate a unique email for each test."""
    return f"test_{int(time.time() * 1000000)}@example.com"


@pytest.fixture(scope="function")
def unique_emp_no():
    """Generate a unique employee number for each test."""
    return f"EMP{int(time.time() * 1000000)}"
