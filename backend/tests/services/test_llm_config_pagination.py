import inspect

from app.api.v1.endpoints import agent
from app.services.llm_config_service import LlmConfigService


def test_llm_config_list_endpoint_returns_page_data():
    route = next(route for route in agent.llm_router.routes if getattr(route, "path", None) == "/llm-configs")
    assert "PageData" in str(route.response_model)


def test_llm_config_service_list_configs_accepts_pagination_filters():
    signature = inspect.signature(LlmConfigService.list_configs)
    assert "page" in signature.parameters
    assert "page_size" in signature.parameters
    assert "keyword" in signature.parameters
    assert "status" in signature.parameters
    # biz_type 已移除（模型全局化后不再按归属过滤）
    assert "biz_type" not in signature.parameters
