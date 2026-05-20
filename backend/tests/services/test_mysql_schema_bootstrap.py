import pytest

from app.db.mysql import LLM_MODEL_CONFIG_SCHEMA_COLUMNS, ensure_llm_model_config_schema


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
