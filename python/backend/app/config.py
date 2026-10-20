from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://rental:rental@localhost:5432/rental_review"
    app_env: str = "development"
    secret_key: str = "local-development-only-change-before-deployment"
    sms_backend: str = "development"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    otp_ttl_seconds: int = 300
    otp_cooldown_seconds: int = 60
    otp_max_attempts: int = 5
    otp_request_phone_limit: int = 5
    otp_request_ip_limit: int = 30
    otp_verify_phone_limit: int = 15
    otp_verify_ip_limit: int = 100
    session_days: int = 7
    upload_dir: Path = Path("uploads")
    max_upload_bytes: int = 5 * 1024 * 1024
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @model_validator(mode="after")
    def validate_deployment(self):
        if self.sms_backend not in {"development", "twilio"}:
            raise ValueError("SMS_BACKEND must be development or twilio")
        if self.app_env == "production" and (
            self.sms_backend == "development"
            or len(self.secret_key) < 32
            or self.secret_key.startswith("local-development")
        ):
            raise ValueError("Production requires a private SECRET_KEY and a real SMS backend")
        if self.sms_backend == "twilio" and not all(
            [self.twilio_account_sid, self.twilio_auth_token, self.twilio_from_number]
        ):
            raise ValueError("Twilio credentials and a sending number are required")
        return self


@lru_cache
def get_settings():
    return Settings()
