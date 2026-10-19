from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PPT Agent API"
    database_url: str = "sqlite:///./ppt_agent.db"
    renderer_url: str = "stub://renderer"
    output_dir: str = "./data"
    auto_create_tables: bool = True
    request_timeout_seconds: float = 30.0
    agent_poll_interval_seconds: float = 0.25
    agent_run_timeout_seconds: int = 300

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

