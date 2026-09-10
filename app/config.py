from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_secret_key: str = "dev-secret-change-me"
    database_url: str = "sqlite:////data/app.db"
    data_dir: Path = Path("/data")
    model_dir: Path = Path("/models")
    frontend_dir: Path = Path("/app/frontend/dist")
    whisper_local_files_only: bool = False
    bootstrap_socks5_proxy: str = ""
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
