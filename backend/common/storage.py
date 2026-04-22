import uuid
from urllib.parse import urlparse

import boto3
from botocore.client import Config
from django.conf import settings


def _public_s3_client():
    return boto3.client(
        's3',
        endpoint_url=settings.AWS_S3_PUBLIC_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(
            signature_version=settings.AWS_S3_SIGNATURE_VERSION,
            s3={'addressing_style': settings.AWS_S3_ADDRESSING_STYLE},
        ),
    )


EXT_FOR_CT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}


def build_object_key(kind: str, content_type: str) -> str:
    prefix = {'item': 'items/', 'avatar': 'avatars/'}[kind]
    ext = EXT_FOR_CT[content_type]
    return f"{prefix}{uuid.uuid4().hex}.{ext}"


def presign_put(object_key: str, content_type: str) -> str:
    return _public_s3_client().generate_presigned_url(
        'put_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': object_key,
            'ContentType': content_type,
        },
        ExpiresIn=settings.UPLOAD_PRESIGN_TTL,
        HttpMethod='PUT',
    )


def presign_get(object_key_or_url: str | None) -> str | None:
    if not object_key_or_url:
        return None
    # Legacy: stored as full URL -> pass through.
    parsed = urlparse(object_key_or_url)
    if parsed.scheme in ('http', 'https'):
        return object_key_or_url
    return _public_s3_client().generate_presigned_url(
        'get_object',
        Params={
            'Bucket': settings.AWS_STORAGE_BUCKET_NAME,
            'Key': object_key_or_url,
        },
        ExpiresIn=settings.DOWNLOAD_PRESIGN_TTL,
    )
