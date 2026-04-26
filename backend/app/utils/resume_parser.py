from pathlib import Path

from docx import Document
from PyPDF2 import PdfReader

from app.core.exceptions import ValidationError


def extract_resume_text(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf_text(file_path)
    if suffix == ".docx":
        return _extract_docx_text(file_path)
    raise ValidationError("只支持 PDF 或 DOCX 格式")


def _extract_pdf_text(file_path: Path) -> str:
    reader = PdfReader(str(file_path))
    texts = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(text.strip() for text in texts if text.strip()).strip()


def _extract_docx_text(file_path: Path) -> str:
    document = Document(str(file_path))
    texts = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    return "\n".join(texts).strip()
