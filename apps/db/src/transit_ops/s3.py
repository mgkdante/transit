from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit, urlunsplit

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError

from transit_ops.settings import Settings

type BucketSetting = Literal["BRONZE_S3_BUCKET", "SNAPSHOT_R2_BUCKET"]


class ObjectStorageError(ValueError):
    """Object storage configuration or I/O failed."""


def validate_s3_bucket_name(bucket: str | None, *, setting: BucketSetting) -> str:
    normalized = (bucket or "").strip()
    if not normalized:
        raise ObjectStorageError(f"{setting} must not be empty when using s3 storage.")
    if "/" in normalized:
        raise ObjectStorageError(f"{setting} must be only the bucket name, without path segments.")
    return normalized


def validated_s3_target(
    settings: Settings, *, bucket_setting: BucketSetting = "BRONZE_S3_BUCKET"
) -> tuple[str, str]:
    bucket = getattr(settings, bucket_setting)
    missing = [
        name
        for name, value in (
            ("BRONZE_S3_ENDPOINT", settings.BRONZE_S3_ENDPOINT),
            (bucket_setting, bucket),
            ("BRONZE_S3_ACCESS_KEY", settings.BRONZE_S3_ACCESS_KEY),
            ("BRONZE_S3_SECRET_KEY", settings.BRONZE_S3_SECRET_KEY),
        )
        if not value
    ]
    if missing:
        domain = "Bronze" if bucket_setting == "BRONZE_S3_BUCKET" else "snapshot"
        raise ObjectStorageError(
            f"S3-compatible {domain} storage requires these settings: {', '.join(missing)}."
        )
    parts = urlsplit((settings.BRONZE_S3_ENDPOINT or "").strip())
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ObjectStorageError(
            "BRONZE_S3_ENDPOINT must be a full http(s) account-level endpoint."
        )
    if parts.path not in {"", "/"} or parts.query or parts.fragment:
        raise ObjectStorageError(
            "BRONZE_S3_ENDPOINT must be the account-level endpoint only. "
            f"Set {bucket_setting} separately."
        )
    return (
        urlunsplit((parts.scheme, parts.netloc, "", "", "")),
        validate_s3_bucket_name(bucket, setting=bucket_setting),
    )


def build_s3_client(
    settings: Settings,
    *,
    bucket_setting: BucketSetting = "BRONZE_S3_BUCKET",
    max_pool_connections: int = 10,
) -> object:
    endpoint, bucket = validated_s3_target(settings, bucket_setting=bucket_setting)
    try:
        client: object = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=settings.BRONZE_S3_ACCESS_KEY,
            aws_secret_access_key=settings.BRONZE_S3_SECRET_KEY,
            region_name=settings.BRONZE_S3_REGION,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
                max_pool_connections=max_pool_connections,
            ),
        )
        return client
    except (BotoCoreError, ValueError) as exc:
        raise ObjectStorageError(
            f"Failed to initialize S3 client for endpoint {endpoint} and bucket {bucket}: {exc}"
        ) from exc
