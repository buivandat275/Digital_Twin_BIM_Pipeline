from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://dt_app:change_me@127.0.0.1:5432/digital_twin"
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8501,http://localhost:8501"
    api_title: str = "Digital Twin Validation API"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]


settings = Settings()
