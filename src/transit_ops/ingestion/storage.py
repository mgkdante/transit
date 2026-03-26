from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from transit_ops.core.models import StorageBackend
from transit_ops.settings import Settings


class BronzeStorageError(ValueError):
    """Raised when Bronze storage configuration or I/O is invalid."""


@dataclass(frozen=True)
class BronzeStorage:
    storage_backend: str

    def persist_temp_file(self, temp_path: Path, storage_path: str) -> str:
        raise NotImplementedError

    def read_bytes(self, storage_path: str) -> bytes:
        raise NotImplementedError

    def exists(self, storage_path: str) -> bool:
        raise NotImplementedError

    def describe_location(self, storage_path: str) -> str:
        raise NotImplementedError


@dataclass(frozen=True)
class LocalBronzeStorage(BronzeStorage):
    root: Path

    def persist_temp_file(self, temp_path: Path, storage_path: str) -> str:
        final_path = self.root / Path(storage_path)
        if final_path.exists():
            raise FileExistsError(f"Bronze archive path already exists: {final_path}")
        final_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path.replace(final_path)
        return str(final_path)

    def read_bytes(self, storage_path: str) -> bytes:
        return (self.root / Path(storage_path)).read_bytes()

    def exists(self, storage_path: str) -> bool:
        return (self.root / Path(storage_path)).exists()

    def describe_location(self, storage_path: str) -> str:
        return str(self.root / Path(storage_path))


@dataclass(frozen=True)
class S3BronzeStorage(BronzeStorage):
    bucket: str
    endpoint_url: str
    client: object

    def persist_temp_file(self, temp_path: Path, storage_path: str) -> str:
        if self.exists(storage_path):
            raise FileExistsError(
                f"Bronze archive object already exists: {self.describe_location(storage_path)}"
            )
        try:
            with temp_path.open("rb") as handle:
                self.client.upload_fileobj(handle, self.bucket, storage_path)
        except (BotoCoreError, ClientError, OSError) as exc:
            raise BronzeStorageError(
                "Failed to upload Bronze artifact to "
                f"{self.describe_location(storage_path)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc
        temp_path.unlink(missing_ok=True)
        return self.describe_location(storage_path)

    def read_bytes(self, storage_path: str) -> bytes:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=storage_path)
            body = response["Body"]
            payload = body.read()
            if hasattr(body, "close"):
                body.close()
            return payload
        except (BotoCoreError, ClientError, OSError) as exc:
            raise BronzeStorageError(
                "Failed to download Bronze artifact from "
                f"{self.describe_location(storage_path)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc

    def exists(self, storage_path: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=storage_path)
        except ClientError as exc:
            error_code = str(exc.response.get("Error", {}).get("Code", ""))
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise BronzeStorageError(
                "Failed to check Bronze artifact existence at "
                f"{self.describe_location(storage_path)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc
        except BotoCoreError as exc:
            raise BronzeStorageError(
                "Failed to check Bronze artifact existence at "
                f"{self.describe_location(storage_path)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc
        return True

    def describe_location(self, storage_path: str) -> str:
        return f"s3://{self.bucket}/{storage_path}"


def resolve_local_bronze_root(settings: Settings, *, project_root: Path) -> Path:
    configured_root = Path(settings.BRONZE_LOCAL_ROOT)
    if configured_root.is_absolute():
        return configured_root
    return project_root / configured_root


def _normalize_s3_endpoint(endpoint_url: str) -> str:
    normalized = endpoint_url.strip()
    if not normalized:
        raise BronzeStorageError("BRONZE_S3_ENDPOINT must not be empty when using s3 storage.")

    parts = urlsplit(normalized)
    if parts.scheme not in {"https", "http"} or not parts.netloc:
        raise BronzeStorageError(
            "BRONZE_S3_ENDPOINT must be a full http(s) account-level endpoint, "
            "for example "
            "'https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com'."
        )
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise BronzeStorageError(
            "BRONZE_S3_ENDPOINT must be the account-level endpoint only. "
            "Do not include the bucket name or any path segments in the endpoint URL. "
            "Set BRONZE_S3_BUCKET separately."
        )
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def _validate_s3_bucket_name(bucket_name: str) -> str:
    normalized = bucket_name.strip()
    if not normalized:
        raise BronzeStorageError("BRONZE_S3_BUCKET must not be empty when using s3 storage.")
    if "/" in normalized:
        raise BronzeStorageError(
            "BRONZE_S3_BUCKET must be only the bucket name. "
            "Do not include it in BRONZE_S3_ENDPOINT or add path segments."
        )
    return normalized


def _validated_s3_target(settings: Settings) -> tuple[str, str]:
    missing_settings = [
        env_var
        for env_var, value in (
            ("BRONZE_S3_ENDPOINT", settings.BRONZE_S3_ENDPOINT),
            ("BRONZE_S3_BUCKET", settings.BRONZE_S3_BUCKET),
            ("BRONZE_S3_ACCESS_KEY", settings.BRONZE_S3_ACCESS_KEY),
            ("BRONZE_S3_SECRET_KEY", settings.BRONZE_S3_SECRET_KEY),
        )
        if not value
    ]
    if missing_settings:
        missing_display = ", ".join(missing_settings)
        raise BronzeStorageError(
            "S3-compatible Bronze storage requires these settings: "
            f"{missing_display}. For Cloudflare R2, use the account-level endpoint in "
            "BRONZE_S3_ENDPOINT and set BRONZE_S3_BUCKET separately."
        )

    endpoint_url = _normalize_s3_endpoint(settings.BRONZE_S3_ENDPOINT or "")
    bucket_name = _validate_s3_bucket_name(settings.BRONZE_S3_BUCKET or "")
    return endpoint_url, bucket_name


def build_s3_client(settings: Settings):  # noqa: ANN201
    endpoint_url, bucket_name = _validated_s3_target(settings)

    try:
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.BRONZE_S3_ACCESS_KEY,
            aws_secret_access_key=settings.BRONZE_S3_SECRET_KEY,
            region_name=settings.BRONZE_S3_REGION,
            config=BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )
    except (BotoCoreError, ValueError) as exc:
        raise BronzeStorageError(
            "Failed to initialize S3-compatible Bronze storage client for endpoint "
            f"{endpoint_url} and bucket {settings.BRONZE_S3_BUCKET}: {exc}"
        ) from exc


def get_bronze_storage(
    settings: Settings,
    *,
    project_root: Path,
    storage_backend: str | None = None,
    s3_client=None,  # noqa: ANN001
) -> BronzeStorage:
    resolved_backend = StorageBackend(storage_backend or settings.BRONZE_STORAGE_BACKEND)
    if resolved_backend == StorageBackend.LOCAL:
        return LocalBronzeStorage(
            storage_backend=resolved_backend.value,
            root=resolve_local_bronze_root(settings, project_root=project_root),
        )
    if resolved_backend == StorageBackend.S3:
        endpoint_url, bucket_name = _validated_s3_target(settings)
        return S3BronzeStorage(
            storage_backend=resolved_backend.value,
            bucket=bucket_name,
            endpoint_url=endpoint_url,
            client=s3_client or build_s3_client(settings),
        )
    raise ValueError(f"Unsupported BRONZE_STORAGE_BACKEND '{resolved_backend.value}'.")
