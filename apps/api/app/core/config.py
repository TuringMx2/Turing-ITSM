from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Turing ITSM API"
    api_env: str = "local"
    api_cors_origins: str = "http://localhost:3000"
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    redis_url: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
