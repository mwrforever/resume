import mimetypes
from pathlib import Path


def get_file_type(file_path: str) -> str:
    """根据文件路径判断文件类型"""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type:
        if 'pdf' in mime_type:
            return 'pdf'
        elif 'word' in mime_type or 'document' in mime_type:
            return 'docx'
        elif 'image' in mime_type:
            return 'image'
    ext = Path(file_path).suffix.lower()
    if ext == '.pdf':
        return 'pdf'
    elif ext in ['.doc', '.docx']:
        return 'docx'
    elif ext in ['.png', '.jpg', '.jpeg', '.gif', '.bmp']:
        return 'image'
    return 'unknown'


def extract_text_from_docx(file_path: str) -> str:
    """提取 Word 文档文本内容"""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs]
        return "\n".join(paragraphs)
    except ImportError:
        raise Exception("python-docx 库未安装")
    except Exception as e:
        raise Exception(f"解析 Word 文档失败: {str(e)}")