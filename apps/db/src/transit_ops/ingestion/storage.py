from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError

from transit_ops.core.models import StorageBackend
from transit_ops.s3 import ObjectStorageError as BronzeStorageError
from transit_ops.s3 import build_s3_client as build_s3_client
from transit_ops.s3 import validated_s3_target
from transit_ops.settings import Settings

logger = logging.getLogger(__name__)


def _normalize_bronze_object_prefix(prefix: str) -> Path:
    prefix_path = Path(prefix)
    if prefix_path.is_absolute() or ".." in prefix_path.parts:
        raise BronzeStorageError(
            "Bronze object prefix must be a relative object-key prefix without parent traversal."
        )
    return prefix_path


@dataclass(frozen=True)
class BronzeObjectInfo:
    storage_path: str
    byte_size: int | None
    last_modified: datetime | None


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

    def delete_object(self, storage_path: str) -> None:
        raise NotImplementedError

    def delete_objects(self, storage_paths: Iterable[str]) -> set[str]:
        failed_paths: set[str] = set()
        for storage_path in storage_paths:
            try:
                self.delete_object(storage_path)
            except Exception as exc:
                logger.error(
                    "Failed to delete Bronze object at %s via '%s' fallback: %s",
                    self.describe_location(storage_path),
                    self.storage_backend,
                    exc,
                )
                failed_paths.add(storage_path)
        return failed_paths

    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]:
        raise NotImplementedError


type BronzeStorageResolver = Callable[[str], BronzeStorage]


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

    def delete_object(self, storage_path: str) -> None:
        (self.root / Path(storage_path)).unlink(missing_ok=True)

    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]:
        prefix_root = self.root / _normalize_bronze_object_prefix(prefix)
        if not prefix_root.exists():
            return

        for object_path in sorted(path for path in prefix_root.rglob("*") if path.is_file()):
            stat = object_path.stat()
            yield BronzeObjectInfo(
                storage_path=object_path.relative_to(self.root).as_posix(),
                byte_size=stat.st_size,
                last_modified=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            )


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
            try:
                payload = body.read()
            except BaseException:
                with suppress(Exception):
                    if hasattr(body, "close"):
                        body.close()
                raise
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

    def delete_object(self, storage_path: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=storage_path)
        except (BotoCoreError, ClientError) as exc:
            raise BronzeStorageError(
                "Failed to delete Bronze artifact at "
                f"{self.describe_location(storage_path)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc

    def delete_objects(self, storage_paths: Iterable[str]) -> set[str]:
        paths = list(storage_paths)
        failed_paths: set[str] = set()
        for offset in range(0, len(paths), 1000):
            chunk = paths[offset : offset + 1000]
            try:
                response = self.client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": [{"Key": path} for path in chunk], "Quiet": True},
                )
            except (BotoCoreError, ClientError) as exc:
                logger.error(
                    "Failed to bulk delete %s Bronze objects from bucket '%s' via endpoint %s: %s",
                    len(chunk),
                    self.bucket,
                    self.endpoint_url,
                    exc,
                )
                failed_paths.update(chunk)
                continue
            for error in response.get("Errors", []):
                if "Key" not in error:
                    continue
                failed_path = str(error["Key"])
                failed_paths.add(failed_path)
                logger.error(
                    "Failed to bulk delete Bronze object '%s' from bucket '%s' "
                    "via endpoint %s: code=%s message=%s",
                    failed_path,
                    self.bucket,
                    self.endpoint_url,
                    error.get("Code", "unknown"),
                    error.get("Message", "unknown"),
                )
        return failed_paths

    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]:
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)
            for page in pages:
                for item in page.get("Contents", []):
                    yield BronzeObjectInfo(
                        storage_path=item["Key"],
                        byte_size=item.get("Size"),
                        last_modified=item.get("LastModified"),
                    )
        except (BotoCoreError, ClientError) as exc:
            raise BronzeStorageError(
                "Failed to list Bronze artifacts under "
                f"{self.describe_location(prefix)} via endpoint {self.endpoint_url}: {exc}"
            ) from exc


def resolve_local_bronze_root(settings: Settings, *, project_root: Path) -> Path:
    configured_root = Path(settings.BRONZE_LOCAL_ROOT)
    if configured_root.is_absolute():
        return configured_root
    return project_root / configured_root


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
        endpoint_url, bucket_name = validated_s3_target(settings)
        return S3BronzeStorage(
            storage_backend=resolved_backend.value,
            bucket=bucket_name,
            endpoint_url=endpoint_url,
            client=s3_client if s3_client is not None else build_s3_client(settings),
        )
    raise ValueError(f"Unsupported BRONZE_STORAGE_BACKEND '{resolved_backend.value}'.")


class BronzeStorageScope:
    """Worker-lifetime owner for lazy Bronze storage and S3 client reuse."""

    def __init__(self, settings: Settings, *, project_root: Path) -> None:
        self._settings = settings
        self._project_root = project_root
        self._storage_by_backend: dict[StorageBackend, BronzeStorage] = {}
        self._s3_client: object | None = None
        self._closed = False

    def resolve(self, storage_backend: str) -> BronzeStorage:
        if self._closed:
            raise RuntimeError("Bronze storage scope is closed.")

        resolved_backend = StorageBackend(storage_backend)
        cached_storage = self._storage_by_backend.get(resolved_backend)
        if cached_storage is not None:
            return cached_storage

        s3_client = None
        if resolved_backend == StorageBackend.S3:
            s3_client = self._s3_client
            if s3_client is None:
                s3_client = build_s3_client(self._settings)
                self._s3_client = s3_client

        storage = get_bronze_storage(
            self._settings,
            project_root=self._project_root,
            storage_backend=resolved_backend.value,
            s3_client=s3_client,
        )
        self._storage_by_backend[resolved_backend] = storage
        return storage

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True

        close = getattr(self._s3_client, "close", None)
        if callable(close):
            close()
