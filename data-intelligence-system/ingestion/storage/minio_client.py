"""
MinIO object storage client for dataset file management.
Provides upload, download, delete, and presigned URL operations.
"""

import io
import logging
import uuid
from datetime import timedelta

from minio import Minio
from minio.error import S3Error

from core.settings import settings
from core.storage import get_minio_client

logger = logging.getLogger(__name__)


class MinIOStorage:
    """Thin wrapper around the MinIO Python client tailored for dataset storage."""

    def __init__(self) -> None:
        self.client = get_minio_client()
        self.bucket_name = settings.MINIO_BUCKET_NAME

    # ── Bucket management ─────────────────────────────────────────────────

    async def ensure_bucket(self) -> None:
        """Create the configured bucket if it does not already exist."""
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logger.info("Created MinIO bucket: %s", self.bucket_name)
            else:
                logger.debug("MinIO bucket already exists: %s", self.bucket_name)
        except S3Error as exc:
            logger.error("Failed to ensure MinIO bucket: %s", exc)
            raise

    # ── Upload ────────────────────────────────────────────────────────────

    async def upload_file(
        self,
        file_data: bytes,
        file_name: str,
        content_type: str,
        dataset_id: str,
        version: int,
    ) -> str:
        """Upload *file_data* to MinIO and return the object storage path.

        Object path format: ``datasets/{dataset_id}/v{version}/{file_name}``
        """
        object_name = f"datasets/{dataset_id}/v{version}/{file_name}"
        data_stream = io.BytesIO(file_data)
        data_length = len(file_data)

        try:
            self.client.put_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                data=data_stream,
                length=data_length,
                content_type=content_type,
            )
            logger.info(
                "Uploaded %s (%d bytes) to %s/%s",
                file_name,
                data_length,
                self.bucket_name,
                object_name,
            )
            return object_name
        except S3Error as exc:
            logger.error("MinIO upload failed for %s: %s", object_name, exc)
            raise

    # ── Download ──────────────────────────────────────────────────────────

    async def download_file(self, storage_path: str) -> bytes:
        """Download an object from MinIO and return its contents as bytes."""
        response = None
        try:
            response = self.client.get_object(self.bucket_name, storage_path)
            data = response.read()
            logger.debug(
                "Downloaded %s (%d bytes) from MinIO", storage_path, len(data)
            )
            return data
        except S3Error as exc:
            logger.error("MinIO download failed for %s: %s", storage_path, exc)
            raise
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    async def download_head(self, storage_path: str, max_bytes: int = 262144) -> bytes:
        """Download only the first ``max_bytes`` of an object via HTTP Range.

        Used for fast inline previews on the Datasets page so we never pull
        multi-MB files just to render 10 rows. Falls back to a streamed read
        of N bytes if the server doesn't honour the offset+length kwargs.
        """
        response = None
        try:
            try:
                response = self.client.get_object(
                    self.bucket_name, storage_path, offset=0, length=max_bytes,
                )
            except TypeError:
                # Older minio clients without offset/length kwargs — fall back
                # to streaming the first chunk.
                response = self.client.get_object(self.bucket_name, storage_path)
            data = response.read(max_bytes)
            logger.debug(
                "Downloaded HEAD of %s (%d bytes) from MinIO", storage_path, len(data)
            )
            return data
        except S3Error as exc:
            logger.error("MinIO head-download failed for %s: %s", storage_path, exc)
            raise
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_file(self, storage_path: str) -> bool:
        """Delete an object from MinIO. Returns ``True`` on success."""
        try:
            self.client.remove_object(self.bucket_name, storage_path)
            logger.info("Deleted %s from MinIO", storage_path)
            return True
        except S3Error as exc:
            logger.error("MinIO delete failed for %s: %s", storage_path, exc)
            return False

    # ── Presigned URL ─────────────────────────────────────────────────────

    async def get_presigned_url(
        self,
        storage_path: str,
        expires: timedelta = timedelta(hours=1),
    ) -> str:
        """Generate a presigned download URL valid for *expires* duration."""
        try:
            url = self.client.presigned_get_object(
                bucket_name=self.bucket_name,
                object_name=storage_path,
                expires=expires,
            )
            logger.debug("Generated presigned URL for %s", storage_path)
            return url
        except S3Error as exc:
            logger.error(
                "Failed to generate presigned URL for %s: %s", storage_path, exc
            )
            raise

    # ── Metadata helpers ──────────────────────────────────────────────────

    def get_file_size(self, storage_path: str) -> int:
        """Return file size in bytes by issuing a stat call."""
        try:
            stat = self.client.stat_object(self.bucket_name, storage_path)
            return stat.size
        except S3Error as exc:
            logger.error("Failed to stat %s: %s", storage_path, exc)
            raise


# ── Singleton instance ────────────────────────────────────────────────────
minio_storage = MinIOStorage()
