from app.config.settings import configure_logging, get_settings
from app.core.container import create_app

settings = get_settings()
configure_logging(settings)
app = create_app(settings)
