import logging
from pathlib import Path

from docx import Document
from PyPDF2 import PdfReader

from app.core.exceptions import ValidationError

logger = logging.getLogger(__name__)


def extract_resume_text(file_path: Path) -> str:
    """从简历文件提取 Markdown 格式文本。

    PDF 和 DOCX 均优先使用 Docling 解析（输出高质量 Markdown），
    Docling 不可用或解析失败时回退到 PyPDF2 / python-docx 纯文本提取。

    Args:
        file_path: 简历文件路径，仅支持 .pdf 和 .docx
    Returns:
        str: 解析后的 Markdown 格式文本
    Raises:
        ValidationError: 不支持的文件格式
    """
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf_text(file_path)
    if suffix == ".docx":
        return _extract_docx_text(file_path)
    raise ValidationError("只支持 PDF 或 DOCX 格式")


def _try_docling_convert(file_path: Path) -> str | None:
    """尝试使用 Docling 统一解析文档，返回 Markdown 文本。

    Docling 支持 PDF、DOCX 等多种格式，输出结构化 Markdown，
    保留标题层级、列表、表格等排版信息。

    Args:
        file_path: 文档文件路径
    Returns:
        str | None: 解析成功返回 Markdown 文本，失败返回 None
    """
    try:
        from docling.document_converter import DocumentConverter

        logger.info("使用 Docling 解析文件: %s", file_path)
        converter = DocumentConverter()
        result = converter.convert(str(file_path))
        text = result.document.export_to_markdown()
        if text and text.strip():
            logger.info("Docling 解析成功，文本长度: %d", len(text))
            return text.strip()
        logger.warning("Docling 解析结果为空")
        return None
    except ImportError:
        logger.warning("Docling 未安装，使用基础解析器")
        return None
    except Exception as exc:
        logger.warning("Docling 解析失败: %s，回退到基础解析器", exc)
        return None


def _extract_pdf_text(file_path: Path) -> str:
    """从 PDF 提取文本，优先 Docling，回退 PyPDF2。

    Args:
        file_path: PDF 文件路径
    Returns:
        str: 提取的文本内容
    """
    docling_result = _try_docling_convert(file_path)
    if docling_result:
        return docling_result

    # 回退: PyPDF2 纯文本提取
    logger.info("使用 PyPDF2 解析 PDF 文件: %s", file_path)
    reader = PdfReader(str(file_path))
    texts = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(text.strip() for text in texts if text.strip()).strip()


def _extract_docx_text(file_path: Path) -> str:
    """从 DOCX 提取文本，优先 Docling，回退 python-docx。

    Args:
        file_path: DOCX 文件路径
    Returns:
        str: 提取的文本内容
    """
    docling_result = _try_docling_convert(file_path)
    if docling_result:
        return docling_result

    # 回退: python-docx 段落提取
    logger.info("使用 python-docx 解析 DOCX 文件: %s", file_path)
    document = Document(str(file_path))
    texts = [
        paragraph.text.strip()
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]
    return "\n".join(texts).strip()