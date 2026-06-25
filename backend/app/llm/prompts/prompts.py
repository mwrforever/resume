"""提示词模板统一入口。

所有模板通过 prompt_manager.render() 按需加载和渲染，
不再预加载常量。模板路径使用「目录/名称」格式，
与 templates/ 下的子目录结构一一对应。
"""

from app.llm.prompts.manager import prompt_manager

__all__ = ["prompt_manager"]