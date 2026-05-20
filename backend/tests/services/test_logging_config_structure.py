from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[2]


def test_logging_configuration_is_owned_by_logging_module() -> None:
    config_source = (BACKEND_DIR / "app" / "core" / "config.py").read_text(encoding="utf-8")
    logging_source = (BACKEND_DIR / "app" / "core" / "logging.py").read_text(encoding="utf-8")

    assert "def configure_logging" not in config_source
    assert "def configure_logging" in logging_source


def test_application_entrypoints_import_logging_configuration_from_logging_module() -> None:
    main_source = (BACKEND_DIR / "app" / "main.py").read_text(encoding="utf-8")
    celery_source = (BACKEND_DIR / "app" / "workers" / "celery_app.py").read_text(encoding="utf-8")

    assert "from app.core.logging import configure_logging" in main_source
    assert "from app.core.logging import configure_logging" in celery_source
    assert "from app.core.config import configure_logging" not in main_source
    assert "from app.core.config import configure_logging" not in celery_source
