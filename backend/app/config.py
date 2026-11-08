import os

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes")


class Settings:
    database_url = os.getenv("DATABASE_URL", "sqlite:///./flow.db")
    auth_mode = os.getenv("AUTH_MODE", "dev")  # dev / entra
    seed_demo = _bool("SEED_DEMO", True)
    tenant_id = os.getenv("ENTRA_TENANT_ID", "")
    api_client_id = os.getenv("ENTRA_API_CLIENT_ID", "")
    cors_origins = [o for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o]


settings = Settings()
