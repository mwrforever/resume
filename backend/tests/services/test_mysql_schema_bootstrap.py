import pytest

from app.db.mysql import (
    LLM_MODEL_CONFIG_SCHEMA_COLUMNS,
    SYS_EMPLOYEE_SCHEMA_COLUMNS,
    LEGACY_ADMIN_EMAIL,
    ensure_llm_model_config_schema,
    ensure_sys_employee_schema,
)


class FakeResult:
    def __init__(self, exists: bool) -> None:
        self.exists = exists

    def first(self):
        return ("field",) if self.exists else None


class FakeConnection:
    def __init__(self, existing_columns: set[str]) -> None:
        self.existing_columns = existing_columns
        self.statements: list[str] = []

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if sql.startswith("SHOW COLUMNS"):
            column_name = sql.split("LIKE '", 1)[1].split("'", 1)[0]
            return FakeResult(column_name in self.existing_columns)
        return FakeResult(True)


@pytest.mark.asyncio
async def test_ensure_llm_model_config_schema_adds_missing_runtime_columns():
    conn = FakeConnection({"id", "biz_type", "biz_id", "config_name", "model_name"})

    await ensure_llm_model_config_schema(conn)

    alter_sql = "\n".join(conn.statements)
    assert "ADD COLUMN enable_thinking" in alter_sql
    assert "ADD COLUMN enable_tools" in alter_sql
    assert "ADD COLUMN enable_prompt_cache" in alter_sql
    assert "ADD COLUMN enable_memory" in alter_sql
    assert "ADD COLUMN is_deleted" in alter_sql


@pytest.mark.asyncio
async def test_ensure_llm_model_config_schema_skips_existing_columns():
    conn = FakeConnection(set(LLM_MODEL_CONFIG_SCHEMA_COLUMNS))

    await ensure_llm_model_config_schema(conn)

    assert all("ADD COLUMN" not in statement for statement in conn.statements)


@pytest.mark.asyncio
async def test_ensure_sys_employee_schema_adds_is_admin_and_backfills_legacy_admin():
    """缺列时应补齐 is_admin，并把旧管理员邮箱置位为 1（避免迁移后权限自举死锁）。"""
    conn = FakeConnection({"id", "emp_no", "real_name", "email", "status", "is_deleted"})

    await ensure_sys_employee_schema(conn)

    sql = "\n".join(conn.statements)
    # 补齐 is_admin 列
    assert "ADD COLUMN is_admin" in sql
    # 同一回事务内回填旧管理员邮箱为 1
    assert f"email = '{LEGACY_ADMIN_EMAIL}'" in sql
    assert "is_admin = 1" in sql


@pytest.mark.asyncio
async def test_ensure_sys_employee_schema_skips_when_is_admin_exists():
    """is_admin 列已存在时不应再执行 ALTER / UPDATE（幂等）。"""
    conn = FakeConnection(set(SYS_EMPLOYEE_SCHEMA_COLUMNS))

    await ensure_sys_employee_schema(conn)

    assert all("ADD COLUMN" not in s and "UPDATE sys_employee" not in s for s in conn.statements)
