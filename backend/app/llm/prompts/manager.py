from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from jinja2 import FileSystemLoader
from jinja2.sandbox import SandboxedEnvironment


class PromptManager:
    def __init__(self, template_dir: Path | None = None):
        self.template_dir = template_dir or Path(__file__).with_name("templates")
        # 数据库中的维度模板可由用户编辑，必须使用沙箱环境限制模板表达式能力。
        self.environment = SandboxedEnvironment(
            loader=FileSystemLoader(str(self.template_dir)),
            autoescape=False,
            trim_blocks=False,
            lstrip_blocks=False,
        )
        # 当前业务只需要变量、循环和过滤器，清空默认全局函数以降低模板注入风险。
        self.environment.globals.clear()

    def render(self, name: str, **context: Any) -> str:
        return self.render_text(self.get_template(name), **context)

    def render_text(self, template_text: str, **context: Any) -> str:
        return self.environment.from_string(template_text).render(**context).strip()

    def get_template(self, name: str) -> str:
        return self._load_template(name).strip()

    @lru_cache(maxsize=64)
    def _load_template(self, name: str) -> str:
        # YAML 文件是提示词唯一来源，读取时统一校验 template 字段，避免运行时拿到空模板。
        template_path = self.template_dir / f"{name}.yaml"
        with template_path.open("r", encoding="utf-8") as file:
            payload = yaml.safe_load(file)
        if not isinstance(payload, dict) or not isinstance(payload.get("template"), str):
            raise ValueError(f"提示词模板格式错误：{name}")
        return payload["template"]


prompt_manager = PromptManager()
