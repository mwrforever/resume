"""防 LIKE 通配符注入：转义 % 和 _ 后执行 ilike 子串匹配"""

from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.elements import BinaryExpression


def safe_ilike(column: InstrumentedAttribute, keyword: str) -> BinaryExpression:
    escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")
