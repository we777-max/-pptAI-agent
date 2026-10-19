from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "PPT Agent API"
    database_url: str = "sqlite:///./ppt_agent.db"
    renderer_url: str = "stub://renderer"
    output_dir: str = "./data"
    # 本地开发便利开关；部署到共享数据库时应设为 false，只依赖 Alembic 迁移管理 schema，避免两处定义漂移。
    auto_create_tables: bool = True
    request_timeout_seconds: float = 30.0
    agent_poll_interval_seconds: float = 0.25
    agent_run_timeout_seconds: int = 300

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

