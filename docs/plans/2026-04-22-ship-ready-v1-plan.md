# Ship-Ready v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a complete v1 of Lost & Found: direct-to-MinIO photo uploads with presigned URLs, coherent claim flow, profile UI, in-app notifications via polling, Telegram contact reveal, admin role with admin panel, and redesigned UI.

**Architecture:** Django 5.1 + DRF backend with MinIO (S3-compatible, private bucket, dual-endpoint presign). Angular 21 standalone-component frontend. Notifications are DB-backed and polled via HTTP every 30s. Contact reveal is a conditional field in `ClaimSerializer`. Admin-gating uses `User.is_staff` + DRF `IsAdminUser`.

**Tech Stack:** Django 5.1, DRF, SimpleJWT (cookie), PostgreSQL 16, MinIO, boto3, Angular 21, RxJS, Tailwind v4.

**Spec:** `docs/specs/2026-04-22-ship-ready-v1.md`

**Testing note:** User explicitly opted out of automated tests for v1. Verification for each task is via `python manage.py check`, DRF browser / curl hits, TypeScript compile (`ng build`), and manual browser smoke tests listed per task. Keep commits atomic so any break is bisectable.

---

## Phase 1 — Backend foundation: storage + model changes

### Task 1.1: Storage settings — dual endpoint, private bucket

**Files:**
- Modify: `backend/config/settings.py` (storage section, around lines 118-129)
- Modify: `.env.example`

- [ ] **Step 1: Rewrite storage block in `backend/config/settings.py`**

Replace the existing `# MinIO / S3 Storage` block with:

```python
# MinIO / S3 Storage
AWS_ACCESS_KEY_ID = os.environ.get('MINIO_ROOT_USER', 'minioadmin')
AWS_SECRET_ACCESS_KEY = os.environ.get('MINIO_ROOT_PASSWORD', 'minioadmin')
AWS_STORAGE_BUCKET_NAME = os.environ.get('MINIO_BUCKET_NAME', 'lostandfound')

# Internal endpoint — used by backend -> MinIO (docker network)
AWS_S3_ENDPOINT_URL = f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}"
# Public endpoint — embedded in presigned URLs that the browser follows
AWS_S3_PUBLIC_ENDPOINT_URL = os.environ.get(
    'MINIO_PUBLIC_ENDPOINT', 'http://localhost:29000'
)

AWS_S3_USE_SSL = False
AWS_S3_VERIFY = False
AWS_S3_FILE_OVERWRITE = False
AWS_QUERYSTRING_AUTH = True  # private bucket -> all GETs are presigned

AWS_S3_SIGNATURE_VERSION = 's3v4'
AWS_S3_ADDRESSING_STYLE = 'path'

DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'

# Allowed image MIME types for presigned uploads
UPLOAD_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
UPLOAD_PRESIGN_TTL = 600      # 10 min for PUT
DOWNLOAD_PRESIGN_TTL = 3600   # 1 h for GET
```

Removed: `AWS_DEFAULT_ACL = 'public-read'`.

- [ ] **Step 2: Add `MINIO_PUBLIC_ENDPOINT` to `.env.example`**

Append:
```
MINIO_PUBLIC_ENDPOINT=http://localhost:29000
```

- [ ] **Step 3: Verify**

```bash
cd backend && python manage.py check
```
Expected: `System check identified no issues`.

- [ ] **Step 4: Commit**

```bash
git add backend/config/settings.py .env.example
git commit -m "config(storage): dual endpoint, private bucket, signed GET/PUT"
```

---

### Task 1.2: Storage helper module

**Files:**
- Create: `backend/common/__init__.py`
- Create: `backend/common/storage.py`

- [ ] **Step 1: Create `backend/common/__init__.py`** (empty file)

- [ ] **Step 2: Create `backend/common/storage.py`**

```python
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
```

- [ ] **Step 3: Register `common` (no migrations, just sanity-import)**

No `INSTALLED_APPS` change needed — `common` is a pure-Python helper package.

- [ ] **Step 4: Verify**

```bash
cd backend && python manage.py shell -c "from common.storage import build_object_key; print(build_object_key('item', 'image/jpeg'))"
```
Expected: `items/<hex>.jpg`.

- [ ] **Step 5: Commit**

```bash
git add backend/common/
git commit -m "feat(storage): presign helpers with dual-endpoint boto3 client"
```

---

### Task 1.3: Upload presign endpoint

**Files:**
- Create: `backend/common/views.py`
- Create: `backend/common/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Create `backend/common/views.py`**

```python
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common.storage import build_object_key, presign_put


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def presign_upload_view(request):
    kind = request.data.get('kind')
    content_type = request.data.get('content_type')

    if kind not in ('item', 'avatar'):
        return Response(
            {'detail': 'kind must be "item" or "avatar".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if content_type not in settings.UPLOAD_ALLOWED_CONTENT_TYPES:
        return Response(
            {'detail': f'content_type must be one of {settings.UPLOAD_ALLOWED_CONTENT_TYPES}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    object_key = build_object_key(kind, content_type)
    upload_url = presign_put(object_key, content_type)
    return Response({
        'upload_url': upload_url,
        'object_key': object_key,
        'expires_in': settings.UPLOAD_PRESIGN_TTL,
    })
```

- [ ] **Step 2: Create `backend/common/urls.py`**

```python
from django.urls import path
from common.views import presign_upload_view

urlpatterns = [
    path('uploads/presign/', presign_upload_view, name='presign-upload'),
]
```

- [ ] **Step 3: Wire in `backend/config/urls.py`**

Current file:
```python
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include('items.urls')),
]
```

Add line after `items.urls`:
```python
    path('api/', include('common.urls')),
```

- [ ] **Step 4: Verify**

```bash
cd backend && python manage.py check && python manage.py show_urls 2>/dev/null | grep presign
```
Expected: check passes; `presign` path visible.

- [ ] **Step 5: Commit**

```bash
git add backend/common/views.py backend/common/urls.py backend/config/urls.py
git commit -m "feat(uploads): presigned PUT endpoint"
```

---

### Task 1.4: MinIO bucket — private + CORS

**Files:**
- Modify: `docker-compose.yml` (createbucket service, around lines 35-46)

- [ ] **Step 1: Rewrite `createbucket` service in `docker-compose.yml`**

Replace the `entrypoint` block with:

```yaml
  createbucket:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    environment:
      MINIO_BUCKET_NAME: ${MINIO_BUCKET_NAME:-lostandfound}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-http://localhost:4200}
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 $${MINIO_ROOT_USER:-minioadmin} $${MINIO_ROOT_PASSWORD:-minioadmin};
      mc mb --ignore-existing local/$${MINIO_BUCKET_NAME};
      ORIGINS=$$(echo \"$${CORS_ALLOWED_ORIGINS}\" | sed 's/,/\",\"/g');
      echo \"{\\\"CORSRules\\\":[{\\\"AllowedOrigins\\\":[\\\"$${ORIGINS}\\\"],\\\"AllowedMethods\\\":[\\\"GET\\\",\\\"PUT\\\",\\\"HEAD\\\"],\\\"AllowedHeaders\\\":[\\\"*\\\"],\\\"ExposeHeaders\\\":[\\\"ETag\\\"]}]}\" > /tmp/cors.json;
      mc anonymous set none local/$${MINIO_BUCKET_NAME} || true;
      mc cors set /tmp/cors.json local/$${MINIO_BUCKET_NAME} || true;
      exit 0;
      "
```

- [ ] **Step 2: Verify**

```bash
docker compose up -d db minio createbucket && docker compose logs createbucket
```
Expected: `createbucket` exits 0, logs show no errors.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "infra(minio): private bucket + CORS for presigned uploads"
```

---

### Task 1.5: Claim model — partial unique constraint

**Files:**
- Modify: `backend/items/models.py` (Claim.Meta, around lines 73-75)

- [ ] **Step 1: Update `Claim.Meta`**

Replace:
```python
    class Meta:
        ordering = ['-created_at']
```
with:
```python
    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'item'],
                condition=models.Q(status='PENDING'),
                name='unique_pending_claim_per_user_item',
            ),
        ]
```

- [ ] **Step 2: Make migration**

```bash
cd backend && python manage.py makemigrations items --name add_unique_pending_claim
```
Expected: creates `backend/items/migrations/0002_add_unique_pending_claim.py`.

- [ ] **Step 3: Apply**

```bash
python manage.py migrate items
```

- [ ] **Step 4: Commit**

```bash
git add backend/items/models.py backend/items/migrations/0002_add_unique_pending_claim.py
git commit -m "feat(claims): prevent duplicate pending claims per user/item"
```

---

### Task 1.6: Item status — drop CLAIMED, data migration

**Files:**
- Modify: `backend/items/models.py` (Item.Status, around line 29-32)
- Create: `backend/items/migrations/0003_drop_claimed_status.py`

- [ ] **Step 1: Update `Item.Status` choices**

Replace:
```python
    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        CLAIMED = 'CLAIMED', 'Claimed'
        RESOLVED = 'RESOLVED', 'Resolved'
```
with:
```python
    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        RESOLVED = 'RESOLVED', 'Resolved'
```

- [ ] **Step 2: Make migration**

```bash
cd backend && python manage.py makemigrations items --name drop_claimed_status
```

- [ ] **Step 3: Add data migration operation**

Open the generated `0003_drop_claimed_status.py` and append to the `operations` list **before** the `AlterField`:

```python
        migrations.RunSQL(
            sql="UPDATE items_item SET status='OPEN' WHERE status='CLAIMED';",
            reverse_sql=migrations.RunSQL.noop,
        ),
```

Full operations list example:
```python
    operations = [
        migrations.RunSQL(
            sql="UPDATE items_item SET status='OPEN' WHERE status='CLAIMED';",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.AlterField(
            model_name='item',
            name='status',
            field=models.CharField(
                choices=[('OPEN', 'Open'), ('RESOLVED', 'Resolved')],
                default='OPEN',
                max_length=8,
            ),
        ),
    ]
```

- [ ] **Step 4: Apply**

```bash
python manage.py migrate items
```

- [ ] **Step 5: Commit**

```bash
git add backend/items/models.py backend/items/migrations/0003_drop_claimed_status.py
git commit -m "feat(items): drop CLAIMED status, migrate existing rows"
```

---

### Task 1.7: Item manager — drop open_found/open_lost dependency; keep simple

**Files:**
- Modify: `backend/items/models.py` (ItemManager)
- Modify: `backend/items/views.py` (stats_view, around lines 178-190)

- [ ] **Step 1: Keep `ItemManager` as-is** — it only uses `item_type='LOST'` + `status='OPEN'` which is still valid.

- [ ] **Step 2: Update `stats_view`** to reflect 2-state world

Replace:
```python
@api_view(['GET'])
@permission_classes([AllowAny])
def stats_view(request):
    total = Item.objects.count()
    open_items = Item.objects.filter(status=Item.Status.OPEN).count()
    resolved = Item.objects.filter(status=Item.Status.RESOLVED).count()
    lost_active = Item.objects.open_lost().count()
    return Response({
        'total_items': total,
        'open_items': open_items,
        'resolved_items': resolved,
        'lost_active': lost_active,
    })
```
with the same content (no functional change — it was already correct). Just double-check no reference to `CLAIMED` remains in views.

```bash
grep -n CLAIMED backend/
```
Expected: no matches.

- [ ] **Step 3: Commit (skip if no changes)**

No commit needed if no code changed.

---

### Task 1.8: Notifications app — scaffold, model, registration

**Files:**
- Create: `backend/notifications/__init__.py`
- Create: `backend/notifications/apps.py`
- Create: `backend/notifications/models.py`
- Create: `backend/notifications/admin.py`
- Create: `backend/notifications/migrations/__init__.py`
- Modify: `backend/config/settings.py` (`INSTALLED_APPS`, around line 28)

- [ ] **Step 1: Create `backend/notifications/apps.py`**

```python
from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notifications'
```

- [ ] **Step 2: Create `backend/notifications/__init__.py`** (empty)

- [ ] **Step 3: Create `backend/notifications/migrations/__init__.py`** (empty)

- [ ] **Step 4: Create `backend/notifications/models.py`**

```python
from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Kind(models.TextChoices):
        CLAIM_CREATED   = 'CLAIM_CREATED',   'Claim created'
        CLAIM_APPROVED  = 'CLAIM_APPROVED',  'Claim approved'
        CLAIM_REJECTED  = 'CLAIM_REJECTED',  'Claim rejected'
        CLAIM_WITHDRAWN = 'CLAIM_WITHDRAWN', 'Claim withdrawn'

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='+',
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    item = models.ForeignKey('items.Item', on_delete=models.CASCADE)
    claim = models.ForeignKey(
        'items.Claim', on_delete=models.SET_NULL, null=True, blank=True
    )
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['recipient', 'read_at'])]

    def __str__(self):
        return f"[{self.kind}] to {self.recipient_id}"
```

- [ ] **Step 5: Create `backend/notifications/admin.py`**

```python
from django.contrib import admin
from notifications.models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'kind', 'item', 'read_at', 'created_at')
    list_filter = ('kind',)
```

- [ ] **Step 6: Register app in `INSTALLED_APPS`**

Add `'notifications',` after `'items',` in `backend/config/settings.py`.

- [ ] **Step 7: Migrate**

```bash
cd backend && python manage.py makemigrations notifications && python manage.py migrate
```

- [ ] **Step 8: Commit**

```bash
git add backend/notifications/ backend/config/settings.py
git commit -m "feat(notifications): new app with Notification model"
```

---

## Phase 2 — Backend endpoints & business logic

### Task 2.1: Notification service — helper to emit

**Files:**
- Create: `backend/notifications/services.py`

- [ ] **Step 1: Create `backend/notifications/services.py`**

```python
from notifications.models import Notification


def notify(*, recipient, actor, kind: str, item, claim=None):
    if recipient == actor:
        # never notify yourself
        return None
    return Notification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=kind,
        item=item,
        claim=claim,
    )
```

- [ ] **Step 2: Commit**

```bash
git add backend/notifications/services.py
git commit -m "feat(notifications): notify() helper"
```

---

### Task 2.2: Notification serializer + views + urls

**Files:**
- Create: `backend/notifications/serializers.py`
- Create: `backend/notifications/views.py`
- Create: `backend/notifications/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Create `backend/notifications/serializers.py`**

```python
from rest_framework import serializers

from notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(
        source='actor.username', read_only=True, default=None
    )
    item_title = serializers.CharField(
        source='item.title', read_only=True
    )

    class Meta:
        model = Notification
        fields = [
            'id', 'kind', 'actor', 'actor_username', 'item', 'item_title',
            'claim', 'read_at', 'created_at',
        ]
        read_only_fields = fields
```

- [ ] **Step 2: Create `backend/notifications/views.py`**

```python
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification
from notifications.serializers import NotificationSerializer


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = None  # custom shape

    def get(self, request):
        qs = Notification.objects.filter(
            recipient=request.user
        ).select_related('actor', 'item')

        unread_count = Notification.objects.filter(
            recipient=request.user, read_at__isnull=True
        ).count()

        if request.query_params.get('unread_only') == 'true':
            qs = qs.filter(read_at__isnull=True)

        try:
            limit = int(request.query_params.get('limit', 20))
        except ValueError:
            limit = 20
        limit = max(1, min(limit, 100))

        results = NotificationSerializer(qs[:limit], many=True).data
        return Response({
            'results': results,
            'unread_count': unread_count,
        })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def mark_read_view(request, pk):
    try:
        n = Notification.objects.get(pk=pk, recipient=request.user)
    except Notification.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if n.read_at is None:
        n.read_at = timezone.now()
        n.save(update_fields=['read_at'])
    return Response(NotificationSerializer(n).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_all_read_view(request):
    Notification.objects.filter(
        recipient=request.user, read_at__isnull=True
    ).update(read_at=timezone.now())
    return Response({'unread_count': 0})
```

- [ ] **Step 3: Create `backend/notifications/urls.py`**

```python
from django.urls import path

from notifications.views import (
    NotificationListView, mark_all_read_view, mark_read_view,
)

urlpatterns = [
    path('', NotificationListView.as_view(), name='notification-list'),
    path('<int:pk>/read/', mark_read_view, name='notification-read'),
    path('read-all/', mark_all_read_view, name='notification-read-all'),
]
```

- [ ] **Step 4: Wire in `backend/config/urls.py`**

Add:
```python
    path('api/notifications/', include('notifications.urls')),
```

- [ ] **Step 5: Verify**

```bash
cd backend && python manage.py check
```

- [ ] **Step 6: Commit**

```bash
git add backend/notifications/ backend/config/urls.py
git commit -m "feat(notifications): list, mark-read, mark-all-read endpoints"
```

---

### Task 2.3: Profile — avatar presign on output, telegram normalization

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py` (`_user_data`, `UserProfileView.patch`)

- [ ] **Step 1: Rewrite `ProfileSerializer` and add telegram validator**

Replace the bottom of `backend/accounts/serializers.py` with:

```python
import re

TELEGRAM_RE = re.compile(r'^[a-zA-Z0-9_]{5,32}$')


def normalize_telegram(raw: str) -> str:
    if raw is None:
        return ''
    t = raw.strip()
    if t.startswith('https://t.me/'):
        t = t[len('https://t.me/'):]
    elif t.startswith('t.me/'):
        t = t[len('t.me/'):]
    if t.startswith('@'):
        t = t[1:]
    return t


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['telegram', 'phone', 'avatar']

    def validate_telegram(self, value):
        if value in (None, ''):
            return ''
        normalized = normalize_telegram(value)
        if not TELEGRAM_RE.match(normalized):
            raise serializers.ValidationError(
                'Telegram handle must be 5-32 chars, letters/digits/underscore only.'
            )
        return normalized
```

Also update `RegisterSerializer.create` (same file) to normalize:

Find:
```python
        if telegram:
            user.profile.telegram = telegram
            user.profile.save()
```
Replace with:
```python
        if telegram:
            user.profile.telegram = normalize_telegram(telegram)
            user.profile.save()
```

- [ ] **Step 2: Update `_user_data` in `backend/accounts/views.py`**

Replace the function:
```python
def _user_data(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'telegram': getattr(user.profile, 'telegram', ''),
        'phone': getattr(user.profile, 'phone', ''),
        'avatar': getattr(user.profile, 'avatar', ''),
    }
```
With:
```python
from common.storage import presign_get


def _user_data(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'is_staff': user.is_staff,
        'telegram': getattr(user.profile, 'telegram', ''),
        'phone': getattr(user.profile, 'phone', ''),
        'avatar_key': getattr(user.profile, 'avatar', '') or None,
        'avatar': presign_get(getattr(user.profile, 'avatar', None)),
    }
```

- [ ] **Step 3: Verify**

```bash
cd backend && python manage.py check
```

- [ ] **Step 4: Commit**

```bash
git add backend/accounts/serializers.py backend/accounts/views.py
git commit -m "feat(accounts): is_staff, telegram normalization, presigned avatar"
```

---

### Task 2.4: Item/Claim serializers — presigned image, annotations, context

**Files:**
- Modify: `backend/items/serializers.py`

- [ ] **Step 1: Rewrite `backend/items/serializers.py`**

```python
from rest_framework import serializers

from common.storage import presign_get
from items.models import Category, Claim, Item


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'icon']


class ClaimSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    user_telegram = serializers.SerializerMethodField()

    class Meta:
        model = Claim
        fields = [
            'id', 'item', 'user', 'username', 'message', 'status',
            'user_telegram', 'created_at',
        ]
        read_only_fields = [
            'id', 'item', 'user', 'username', 'status',
            'user_telegram', 'created_at',
        ]

    def get_user_telegram(self, obj: Claim):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        if obj.status != 'APPROVED':
            return None
        if request.user != obj.item.user and request.user != obj.user:
            return None
        return getattr(obj.user.profile, 'telegram', '') or None


class ItemSerializer(serializers.ModelSerializer):
    category_detail = CategorySerializer(source='category', read_only=True)
    claims = ClaimSerializer(many=True, read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    owner_telegram = serializers.SerializerMethodField()
    pending_claims_count = serializers.SerializerMethodField()
    image_key = serializers.CharField(
        source='image', read_only=True, allow_null=True,
    )
    image = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = [
            'id', 'user', 'username', 'title', 'description',
            'item_type', 'status', 'category', 'category_detail',
            'location', 'image', 'image_key',
            'owner_telegram', 'pending_claims_count',
            'created_at', 'updated_at', 'claims',
        ]
        read_only_fields = [
            'id', 'user', 'username', 'status',
            'image_key', 'pending_claims_count', 'owner_telegram',
            'created_at', 'updated_at',
        ]

    def get_image(self, obj: Item):
        return presign_get(obj.image)

    def get_pending_claims_count(self, obj: Item):
        return sum(1 for c in obj.claims.all() if c.status == 'PENDING')

    def get_owner_telegram(self, obj: Item):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        # Reveal owner telegram to users whose claim on this item is APPROVED
        approved_claim = next(
            (c for c in obj.claims.all()
             if c.user_id == request.user.id and c.status == 'APPROVED'),
            None,
        )
        if approved_claim is None:
            return None
        return getattr(obj.user.profile, 'telegram', '') or None

    def to_internal_value(self, data):
        # Accept image as object_key or null on write
        return super().to_internal_value(data)
```

- [ ] **Step 2: Verify**

```bash
cd backend && python manage.py check
```

- [ ] **Step 3: Commit**

```bash
git add backend/items/serializers.py
git commit -m "feat(items): presigned image URLs, telegram reveal, claim count"
```

---

### Task 2.5: Views — pass request context to every serializer

**Files:**
- Modify: `backend/items/views.py`

- [ ] **Step 1: Update every `XxxSerializer(...)` call to pass context**

In `backend/items/views.py`, locate each instantiation and add `context={'request': request}`:

- Line ~43: `serializer = ItemSerializer(page, many=True)` → `ItemSerializer(page, many=True, context={'request': request})`
- Line ~47: `serializer = ItemSerializer(data=request.data)` → `ItemSerializer(data=request.data, context={'request': request})`
- Line ~63: `serializer = ItemSerializer(item)` → `ItemSerializer(item, context={'request': request})`
- Line ~72: `serializer = ItemSerializer(item, data=request.data)` → `ItemSerializer(item, data=request.data, context={'request': request})`
- Line ~89: `serializer = ItemSerializer(items, many=True)` → `ItemSerializer(items, many=True, context={'request': request})`
- Line ~107: `serializer = ClaimSerializer(data=request.data)` → `ClaimSerializer(data=request.data, context={'request': request})`
- Line ~133: `serializer = ClaimSerializer(claims, many=True)` → `ClaimSerializer(claims, many=True, context={'request': request})`
- Line ~165: `serializer = ClaimSerializer(claim)` → `ClaimSerializer(claim, context={'request': request})`

- [ ] **Step 2: Verify**

```bash
cd backend && python manage.py check && grep -n "Serializer(" backend/items/views.py
```
Every call should pass `context=`.

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py
git commit -m "fix(items): thread request context through serializers"
```

---

### Task 2.6: Claim creation — drop CLAIMED flip, catch IntegrityError, notify

**Files:**
- Modify: `backend/items/views.py` (`create_claim_view`, around lines 93-115)

- [ ] **Step 1: Rewrite `create_claim_view`**

Replace the current implementation with:

```python
from django.db import IntegrityError

from notifications.services import notify
from notifications.models import Notification


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_claim_view(request, pk):
    try:
        item = Item.objects.get(pk=pk)
    except Item.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if item.user == request.user:
        return Response(
            {'detail': 'Cannot claim your own item.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if item.status == Item.Status.RESOLVED:
        return Response(
            {'detail': 'Item is already resolved.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = ClaimSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    try:
        claim = serializer.save(item=item, user=request.user)
    except IntegrityError:
        return Response(
            {'detail': 'You already have a pending claim on this item.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    notify(
        recipient=item.user,
        actor=request.user,
        kind=Notification.Kind.CLAIM_CREATED,
        item=item,
        claim=claim,
    )

    return Response(
        ClaimSerializer(claim, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )
```

Note: the `Item.Status.CLAIMED` assignment is **removed**.

- [ ] **Step 2: Verify**

```bash
cd backend && python manage.py check
```

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py
git commit -m "feat(claims): prevent duplicate/resolved claims, emit notifications"
```

---

### Task 2.7: Claim approve/reject — new semantics

**Files:**
- Modify: `backend/items/views.py` (`approve_reject_view`)

- [ ] **Step 1: Rewrite `approve_reject_view`**

```python
from django.db import transaction


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def approve_reject_view(request, pk, action):
    try:
        claim = Claim.objects.select_related('item', 'user').get(pk=pk)
    except Claim.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if claim.item.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if claim.status != Claim.Status.PENDING:
        return Response(
            {'detail': 'Claim is not pending.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action == 'approve':
        with transaction.atomic():
            claim.status = Claim.Status.APPROVED
            claim.save(update_fields=['status'])
            claim.item.status = Item.Status.RESOLVED
            claim.item.save(update_fields=['status'])

            # Auto-reject remaining pending claims on this item
            other_pending = Claim.objects.filter(
                item=claim.item, status=Claim.Status.PENDING
            ).exclude(pk=claim.pk).select_related('user')
            for other in other_pending:
                other.status = Claim.Status.REJECTED
                other.save(update_fields=['status'])
                notify(
                    recipient=other.user,
                    actor=request.user,
                    kind=Notification.Kind.CLAIM_REJECTED,
                    item=claim.item,
                    claim=other,
                )

        notify(
            recipient=claim.user,
            actor=request.user,
            kind=Notification.Kind.CLAIM_APPROVED,
            item=claim.item,
            claim=claim,
        )

    elif action == 'reject':
        claim.status = Claim.Status.REJECTED
        claim.save(update_fields=['status'])
        # Item.status intentionally untouched
        notify(
            recipient=claim.user,
            actor=request.user,
            kind=Notification.Kind.CLAIM_REJECTED,
            item=claim.item,
            claim=claim,
        )

    else:
        return Response(
            {'detail': 'Invalid action.'}, status=status.HTTP_400_BAD_REQUEST
        )

    return Response(
        ClaimSerializer(claim, context={'request': request}).data
    )
```

- [ ] **Step 2: Commit**

```bash
git add backend/items/views.py
git commit -m "feat(claims): approve cascades rejects, reject leaves item OPEN"
```

---

### Task 2.8: Withdraw claim — DELETE endpoint

**Files:**
- Modify: `backend/items/views.py`
- Modify: `backend/items/urls.py`

- [ ] **Step 1: Add `withdraw_claim_view` at the bottom of `backend/items/views.py`**

```python
@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def withdraw_claim_view(request, pk):
    try:
        claim = Claim.objects.select_related('item').get(pk=pk)
    except Claim.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if claim.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if claim.status != Claim.Status.PENDING:
        return Response(
            {'detail': 'Only pending claims can be withdrawn.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    item_owner = claim.item.user
    item = claim.item
    claim.delete()

    notify(
        recipient=item_owner,
        actor=request.user,
        kind=Notification.Kind.CLAIM_WITHDRAWN,
        item=item,
        claim=None,
    )

    return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 2: Wire the URL in `backend/items/urls.py`**

Add import:
```python
from items.views import (
    ...,
    withdraw_claim_view,
)
```

Add to `urlpatterns`:
```python
    path('claims/<int:pk>/withdraw/', withdraw_claim_view, name='claim-withdraw'),
```

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py backend/items/urls.py
git commit -m "feat(claims): claimant can withdraw own pending claim"
```

---

### Task 2.9: My Claims endpoint

**Files:**
- Modify: `backend/items/views.py`
- Modify: `backend/items/urls.py`

- [ ] **Step 1: Add `MyClaimsView` to `backend/items/views.py`**

```python
class MyClaimsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        claims = Claim.objects.filter(
            user=request.user
        ).select_related('item', 'item__category', 'item__user')
        data = ClaimSerializer(claims, many=True, context={'request': request}).data

        # Enrich with minimal item snapshot for the UI
        items_by_id = {c.item_id: c.item for c in claims}
        for row in data:
            item = items_by_id[row['item']]
            row['item_snapshot'] = {
                'id': item.id,
                'title': item.title,
                'item_type': item.item_type,
                'status': item.status,
                'image': presign_get(item.image),
            }
        return Response(data)
```

Add import at top: `from common.storage import presign_get`.

- [ ] **Step 2: Wire URL**

In `backend/items/urls.py`, add:
```python
    path('claims/my/', MyClaimsView.as_view(), name='my-claims'),
```

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py backend/items/urls.py
git commit -m "feat(claims): GET /api/claims/my/"
```

---

### Task 2.10: Item edit/delete — allow admin for delete

**Files:**
- Modify: `backend/items/views.py` (`item_detail_view`, around lines 53-79)

- [ ] **Step 1: Update permission check in `item_detail_view`**

Replace the permission block:
```python
    if not request.user.is_authenticated or item.user != request.user:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
```
With:
```python
    if not request.user.is_authenticated:
        return Response(
            {'detail': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED
        )
    is_owner = item.user == request.user
    is_admin = request.user.is_staff
    if request.method == 'PUT' and not is_owner:
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
    if request.method == 'DELETE' and not (is_owner or is_admin):
        return Response(
            {'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN
        )
```

- [ ] **Step 2: Commit**

```bash
git add backend/items/views.py
git commit -m "feat(items): admins can delete any item"
```

---

### Task 2.11: Admin category CRUD

**Files:**
- Modify: `backend/items/views.py` (`CategoryListView`)
- Modify: `backend/items/urls.py`

- [ ] **Step 1: Replace `CategoryListView` with `CategoryListCreateView` and `CategoryDetailView`**

Replace the existing `CategoryListView` block:

```python
from rest_framework.permissions import IsAdminUser


class CategoryListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdminUser()]
        return [AllowAny()]

    def get(self, request):
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = CategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CategoryDetailView(APIView):
    permission_classes = [IsAdminUser]

    def _get(self, pk):
        try:
            return Category.objects.get(pk=pk)
        except Category.DoesNotExist:
            return None

    def patch(self, request, pk):
        cat = self._get(pk)
        if cat is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = CategorySerializer(cat, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        cat = self._get(pk)
        if cat is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        cat.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 2: Update `backend/items/urls.py`**

Replace the category line and add detail:
```python
    path('categories/', CategoryListCreateView.as_view(), name='category-list-create'),
    path('categories/<int:pk>/', CategoryDetailView.as_view(), name='category-detail'),
```

Update imports accordingly.

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py backend/items/urls.py
git commit -m "feat(admin): category CRUD (admin-only)"
```

---

### Task 2.12: Admin items list + force-resolve

**Files:**
- Modify: `backend/items/views.py`
- Modify: `backend/items/urls.py`

- [ ] **Step 1: Append to `backend/items/views.py`**

```python
class AdminItemListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        qs = Item.objects.select_related('user', 'category').prefetch_related(
            'claims__user'
        )
        if (t := request.query_params.get('type')):
            qs = qs.filter(item_type=t)
        if (s := request.query_params.get('status')):
            qs = qs.filter(status=s)
        if (u := request.query_params.get('user_id')):
            qs = qs.filter(user_id=u)

        from rest_framework.pagination import PageNumberPagination
        paginator = PageNumberPagination()
        paginator.page_size = 20
        page = paginator.paginate_queryset(qs, request)
        serializer = ItemSerializer(page, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def force_resolve_view(request, pk):
    try:
        item = Item.objects.get(pk=pk)
    except Item.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if item.status == Item.Status.RESOLVED:
        return Response(
            {'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST
        )

    with transaction.atomic():
        item.status = Item.Status.RESOLVED
        item.save(update_fields=['status'])
        pending = Claim.objects.filter(
            item=item, status=Claim.Status.PENDING
        ).select_related('user')
        for c in pending:
            c.status = Claim.Status.REJECTED
            c.save(update_fields=['status'])
            notify(
                recipient=c.user,
                actor=request.user,
                kind=Notification.Kind.CLAIM_REJECTED,
                item=item,
                claim=c,
            )

    return Response(ItemSerializer(item, context={'request': request}).data)
```

- [ ] **Step 2: Wire URLs**

In `backend/items/urls.py`:
```python
    path('admin/items/', AdminItemListView.as_view(), name='admin-item-list'),
    path('items/<int:pk>/force-resolve/', force_resolve_view, name='force-resolve'),
```

- [ ] **Step 3: Commit**

```bash
git add backend/items/views.py backend/items/urls.py
git commit -m "feat(admin): item moderation list + force-resolve"
```

---

### Task 2.13: Backend smoke test

- [ ] **Step 1: Run the full stack**

```bash
docker compose up -d --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py loaddata categories
docker compose exec backend python manage.py createsuperuser  # one-time
```

- [ ] **Step 2: Smoke-test presign**

```bash
# Register a user, log in (get cookies), then:
curl -b cookies.txt -X POST http://localhost:8000/api/uploads/presign/ \
  -H 'Content-Type: application/json' \
  -d '{"kind":"item","content_type":"image/jpeg"}'
```
Expected: `{"upload_url":"http://localhost:29000/...","object_key":"items/...","expires_in":600}`.

- [ ] **Step 3: Smoke-test PUT to presigned URL** (copy `upload_url` from above)

```bash
curl -X PUT -H 'Content-Type: image/jpeg' --data-binary @testfile.jpg "<upload_url>"
```
Expected: HTTP 200.

- [ ] **Step 4: Verify image visible via presigned GET** — create an Item with `image=<object_key>` via the API, then fetch the item — `image` field should be a presigned URL starting with `http://localhost:29000/`.

- [ ] **Step 5: No commit** (verification only).

---

## Phase 3 — Frontend infrastructure

### Task 3.1: User interface — add is_staff, avatar_key

**Files:**
- Modify: `frontend/src/app/interfaces/user.interface.ts`

- [ ] **Step 1: Update `User` interface**

```typescript
export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  telegram: string;
  phone: string;
  avatar: string | null;        // presigned GET URL
  avatar_key: string | null;    // object key, for re-submit on profile update
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/interfaces/user.interface.ts
git commit -m "feat(auth): add is_staff and avatar_key to User type"
```

---

### Task 3.2: AuthService — isAdmin$

**Files:**
- Modify: `frontend/src/app/services/auth.service.ts`

- [ ] **Step 1: Add observable**

In `auth.service.ts`, add after `isLoggedIn$`:

```typescript
  isAdmin$ = this.currentUser$.pipe(map(u => !!u?.is_staff));
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/services/auth.service.ts
git commit -m "feat(auth): isAdmin$ observable"
```

---

### Task 3.3: adminGuard

**Files:**
- Create: `frontend/src/app/guards/admin.guard.ts`

- [ ] **Step 1: Create the guard**

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAdmin$.pipe(
    take(1),
    map(isAdmin => {
      if (!isAdmin) {
        router.navigate(['/feed']);
        return false;
      }
      return true;
    }),
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/guards/admin.guard.ts
git commit -m "feat(auth): adminGuard"
```

---

### Task 3.4: UploadService

**Files:**
- Create: `frontend/src/app/services/upload.service.ts`

- [ ] **Step 1: Create the service**

```typescript
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, switchMap, map } from 'rxjs';

interface PresignResponse {
  upload_url: string;
  object_key: string;
  expires_in: number;
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private http = inject(HttpClient);

  /** Uploads `file` directly to MinIO. Returns the stored object_key. */
  upload(file: File, kind: 'item' | 'avatar'): Observable<string> {
    const contentType = file.type;
    return this.http.post<PresignResponse>('/api/uploads/presign/', {
      kind,
      content_type: contentType,
    }).pipe(
      switchMap(res =>
        this.http.put(res.upload_url, file, {
          headers: { 'Content-Type': contentType },
          // Don't send credentials to MinIO — presigned URL is auth
          withCredentials: false,
        }).pipe(map(() => res.object_key)),
      ),
    );
  }
}
```

- [ ] **Step 2: Update `auth.interceptor.ts` to not inject CSRF/credentials on MinIO requests**

In `frontend/src/app/interceptors/auth.interceptor.ts`, at the very top of the function body, before anything else:

```typescript
  // Bypass interceptor entirely for direct-to-MinIO uploads
  if (req.url.startsWith('http://localhost:29000') ||
      req.url.includes('.amazonaws.com') ||
      req.url.includes('/minio/')) {
    return next(req);
  }
```

Place this right after `const auth = inject(AuthService);` (before `let cloned = req.clone({ withCredentials: true });`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/services/upload.service.ts frontend/src/app/interceptors/auth.interceptor.ts
git commit -m "feat(uploads): UploadService + interceptor bypass for MinIO"
```

---

### Task 3.5: NotificationService with polling

**Files:**
- Create: `frontend/src/app/interfaces/notification.interface.ts`
- Create: `frontend/src/app/services/notification.service.ts`

- [ ] **Step 1: Create interface**

```typescript
export type NotificationKind =
  | 'CLAIM_CREATED'
  | 'CLAIM_APPROVED'
  | 'CLAIM_REJECTED'
  | 'CLAIM_WITHDRAWN';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  actor: number | null;
  actor_username: string | null;
  item: number;
  item_title: string;
  claim: number | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  results: AppNotification[];
  unread_count: number;
}
```

- [ ] **Step 2: Create service**

```typescript
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, EMPTY, Subject, fromEvent, merge, of, timer } from 'rxjs';
import { filter, startWith, switchMap, tap, catchError } from 'rxjs';

import { AppNotification, NotificationListResponse } from '../interfaces/notification.interface';
import { AuthService } from './auth.service';

const POLL_INTERVAL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private listSubject = new BehaviorSubject<AppNotification[]>([]);
  private unreadSubject = new BehaviorSubject<number>(0);

  list$ = this.listSubject.asObservable();
  unreadCount$ = this.unreadSubject.asObservable();

  private kick$ = new Subject<void>();

  constructor() {
    const visibility$ = fromEvent(document, 'visibilitychange').pipe(
      startWith(null),
      filter(() => document.visibilityState === 'visible'),
    );

    // Tick when tab becomes visible AND user is logged in, then every POLL_INTERVAL_MS.
    this.auth.isLoggedIn$.pipe(
      switchMap(loggedIn => {
        if (!loggedIn) {
          this.listSubject.next([]);
          this.unreadSubject.next(0);
          return EMPTY;
        }
        return merge(visibility$, this.kick$).pipe(
          switchMap(() => timer(0, POLL_INTERVAL_MS)),
          filter(() => document.visibilityState === 'visible'),
          switchMap(() => this.fetch()),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe();
  }

  private fetch() {
    return this.http.get<NotificationListResponse>('/api/notifications/?limit=20').pipe(
      tap(res => {
        this.listSubject.next(res.results);
        this.unreadSubject.next(res.unread_count);
      }),
      catchError(() => of(null)),
    );
  }

  refresh() {
    this.kick$.next();
  }

  markRead(id: number) {
    return this.http.patch<AppNotification>(`/api/notifications/${id}/read/`, {}).pipe(
      tap(() => this.refresh()),
    );
  }

  markAllRead() {
    return this.http.post<{ unread_count: number }>('/api/notifications/read-all/', {}).pipe(
      tap(() => this.refresh()),
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/interfaces/notification.interface.ts frontend/src/app/services/notification.service.ts
git commit -m "feat(notifications): polling service"
```

---

### Task 3.6: AdminService

**Files:**
- Create: `frontend/src/app/services/admin.service.ts`

- [ ] **Step 1: Create service**

```typescript
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Category } from '../interfaces/category.interface';
import { Item, PaginatedItems } from '../interfaces/item.interface';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  createCategory(data: { name: string; icon: string }): Observable<Category> {
    return this.http.post<Category>('/api/categories/', data);
  }
  updateCategory(id: number, data: Partial<Category>): Observable<Category> {
    return this.http.patch<Category>(`/api/categories/${id}/`, data);
  }
  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`/api/categories/${id}/`);
  }

  listItems(filters: { type?: string; status?: string; user_id?: number; page?: number }): Observable<PaginatedItems> {
    let qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)); });
    return this.http.get<PaginatedItems>(`/api/admin/items/?${qs.toString()}`);
  }

  forceResolve(itemId: number): Observable<Item> {
    return this.http.post<Item>(`/api/items/${itemId}/force-resolve/`, {});
  }

  deleteItem(itemId: number): Observable<void> {
    return this.http.delete<void>(`/api/items/${itemId}/`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/services/admin.service.ts
git commit -m "feat(admin): admin HTTP service"
```

---

### Task 3.7: ClaimService — withdraw + my claims

**Files:**
- Modify: `frontend/src/app/services/claim.service.ts`

- [ ] **Step 1: Read current file and add methods**

Open `claim.service.ts`. Add:

```typescript
  withdraw(claimId: number): Observable<void> {
    return this.http.delete<void>(`/api/claims/${claimId}/withdraw/`);
  }

  myClaims(): Observable<MyClaim[]> {
    return this.http.get<MyClaim[]>('/api/claims/my/');
  }
```

And the type (near the top of the file or in `claim.interface.ts`):

```typescript
export interface MyClaim {
  id: number;
  item: number;
  user: number;
  username: string;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  user_telegram: string | null;
  created_at: string;
  item_snapshot: {
    id: number;
    title: string;
    item_type: 'LOST' | 'FOUND';
    status: 'OPEN' | 'RESOLVED';
    image: string | null;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/services/claim.service.ts frontend/src/app/interfaces/claim.interface.ts
git commit -m "feat(claims): withdraw + myClaims service methods"
```

---

## Phase 4 — Frontend pages & components

### Task 4.1: ImageUpload component

**Files:**
- Create: `frontend/src/app/components/image-upload/image-upload.ts`

- [ ] **Step 1: Create component**

```typescript
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { UploadService } from '../../services/upload.service';

@Component({
  selector: 'app-image-upload',
  standalone: true,
  template: `
    <div class="flex items-center gap-4">
      @if (previewUrl || existingUrl) {
        <img [src]="previewUrl || existingUrl" class="w-20 h-20 rounded-md object-cover border border-gray-200" />
      } @else {
        <div class="w-20 h-20 rounded-md bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No image</div>
      }
      <label class="inline-flex items-center px-3 py-2 rounded-md bg-gray-900 text-white text-sm cursor-pointer hover:bg-gray-800">
        <input type="file" accept="image/jpeg,image/png,image/webp" (change)="onFile($event)" class="hidden" />
        {{ uploading() ? 'Uploading…' : 'Choose image' }}
      </label>
      @if (error()) { <span class="text-red-600 text-sm">{{ error() }}</span> }
    </div>
  `,
})
export class ImageUpload {
  @Input() kind: 'item' | 'avatar' = 'item';
  @Input() existingUrl: string | null = null;
  @Output() uploaded = new EventEmitter<string>(); // emits object_key

  private uploads = inject(UploadService);
  uploading = signal(false);
  error = signal<string | null>(null);
  previewUrl: string | null = null;

  onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.error.set('Only JPG / PNG / WebP allowed.');
      return;
    }
    this.error.set(null);
    this.previewUrl = URL.createObjectURL(file);
    this.uploading.set(true);
    this.uploads.upload(file, this.kind).subscribe({
      next: key => {
        this.uploading.set(false);
        this.uploaded.emit(key);
      },
      error: () => {
        this.uploading.set(false);
        this.error.set('Upload failed. Try again.');
      },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/image-upload/
git commit -m "feat(ui): ImageUpload component"
```

---

### Task 4.2: Wire ImageUpload into post-item

**Files:**
- Modify: `frontend/src/app/pages/post-item/post-item.ts`

- [ ] **Step 1: Replace the image URL text input**

Open `post-item.ts`. Find the `[(ngModel)]="imageUrl"` input block and replace with the component:

```html
<label class="block text-sm font-medium text-gray-700 mb-1">Photo</label>
<app-image-upload kind="item" (uploaded)="imageKey = $event"></app-image-upload>
```

Update the component decorator `imports`:
- Add `ImageUpload` from `../../components/image-upload/image-upload`.

Update the class:
- Remove `imageUrl`.
- Add `imageKey = '';`.
- In the submit payload, replace `image: this.imageUrl` with `image: this.imageKey || null`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/pages/post-item/post-item.ts
git commit -m "feat(post): upload image via ImageUpload"
```

---

### Task 4.3: Profile page

**Files:**
- Create: `frontend/src/app/pages/profile/profile.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Create the component**

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ImageUpload } from '../../components/image-upload/image-upload';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, RouterLink, ImageUpload],
  template: `
    <div class="max-w-xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Profile</h1>
      @if (saved()) {
        <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">Saved.</div>
      }
      @if (error()) {
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error() }}</div>
      }

      <div class="space-y-4 bg-white rounded-lg border border-gray-200 p-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Avatar</label>
          <app-image-upload kind="avatar" [existingUrl]="avatarUrl" (uploaded)="avatarKey = $event"></app-image-upload>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">First name</label>
          <input [(ngModel)]="form.first_name" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Last name</label>
          <input [(ngModel)]="form.last_name" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Telegram</label>
          <input [(ngModel)]="form.telegram" placeholder="@handle" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          <p class="text-xs text-gray-500 mt-1">Used to reach you when a claim is approved.</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input [(ngModel)]="form.phone" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>

        <div class="pt-2">
          <button (click)="save()" [disabled]="saving()" class="px-4 py-2 bg-gray-900 text-white rounded-md disabled:opacity-50">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
          <a routerLink="/feed" class="ml-3 text-sm text-gray-600">Cancel</a>
        </div>
      </div>
    </div>
  `,
})
export class Profile implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  form = { first_name: '', last_name: '', telegram: '', phone: '' };
  avatarKey: string | null = null;
  avatarUrl: string | null = null;

  saving = signal(false);
  saved = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    const u = this.auth.currentUser;
    if (!u) { this.router.navigate(['/login']); return; }
    this.form.first_name = u.first_name || '';
    this.form.last_name = u.last_name || '';
    this.form.telegram = u.telegram || '';
    this.form.phone = u.phone || '';
    this.avatarUrl = u.avatar;
    this.avatarKey = u.avatar_key;
  }

  save() {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.auth.updateProfile({
      ...this.form,
      avatar: this.avatarKey ?? '',
    } as any).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); },
      error: err => {
        this.saving.set(false);
        const e = err.error;
        this.error.set(typeof e === 'object' ? (Object.values(e)[0] as any) : 'Save failed.');
      },
    });
  }
}
```

- [ ] **Step 2: Add route to `app.routes.ts`**

```typescript
  { path: 'profile', loadComponent: () => import('./pages/profile/profile').then(m => m.Profile), canActivate: [authGuard] },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/pages/profile/ frontend/src/app/app.routes.ts
git commit -m "feat(profile): edit first/last name, telegram, phone, avatar"
```

---

### Task 4.4: My Claims page

**Files:**
- Create: `frontend/src/app/pages/my-claims/my-claims.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Create component**

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClaimService } from '../../services/claim.service';
import { MyClaim } from '../../interfaces/claim.interface';

@Component({
  selector: 'app-my-claims',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <div class="max-w-3xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">My claims</h1>
      @if (loading()) {
        <p class="text-gray-500">Loading…</p>
      } @else if (claims().length === 0) {
        <p class="text-gray-500">You haven't claimed any items yet.</p>
      } @else {
        <div class="space-y-3">
          @for (c of claims(); track c.id) {
            <a [routerLink]="['/items', c.item]" class="block p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300">
              <div class="flex items-start gap-4">
                @if (c.item_snapshot.image) {
                  <img [src]="c.item_snapshot.image" class="w-16 h-16 rounded-md object-cover" />
                }
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full border"
                      [class.bg-yellow-50]="c.status === 'PENDING'"
                      [class.border-yellow-200]="c.status === 'PENDING'"
                      [class.text-yellow-800]="c.status === 'PENDING'"
                      [class.bg-green-50]="c.status === 'APPROVED'"
                      [class.border-green-200]="c.status === 'APPROVED'"
                      [class.text-green-800]="c.status === 'APPROVED'"
                      [class.bg-red-50]="c.status === 'REJECTED'"
                      [class.border-red-200]="c.status === 'REJECTED'"
                      [class.text-red-800]="c.status === 'REJECTED'"
                    >{{ c.status }}</span>
                    <h3 class="font-medium">{{ c.item_snapshot.title }}</h3>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">{{ c.message }}</p>
                  <p class="text-xs text-gray-400 mt-1">{{ c.created_at | date:'medium' }}</p>
                  @if (c.status === 'APPROVED' && c.user_telegram) {
                    <a [href]="'https://t.me/' + c.user_telegram" target="_blank" class="inline-block mt-2 text-sm text-blue-600 hover:underline">
                      Contact owner on Telegram ▶
                    </a>
                  }
                </div>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class MyClaims implements OnInit {
  private claimService = inject(ClaimService);
  claims = signal<MyClaim[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.claimService.myClaims().subscribe({
      next: cs => { this.claims.set(cs); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
```

Note: the owner telegram for an approved claim needs to be exposed on the claim-my endpoint. The `MyClaimsView` already serializes via `ClaimSerializer`, which fills `user_telegram` for the **claimant viewing the item owner's telegram** — but our serializer currently fills `user_telegram` as the claim user's telegram, not the item owner's. **Fix-up step below** in this task.

- [ ] **Step 2: Add a second field to ClaimSerializer for the owner side**

In `backend/items/serializers.py`, add to `ClaimSerializer`:

```python
    owner_telegram = serializers.SerializerMethodField()
    # add 'owner_telegram' to Meta.fields and read_only_fields

    def get_owner_telegram(self, obj: Claim):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        if obj.status != 'APPROVED':
            return None
        if request.user != obj.item.user and request.user != obj.user:
            return None
        return getattr(obj.item.user.profile, 'telegram', '') or None
```

Update `MyClaim` TS interface (in `claim.interface.ts`) to add `owner_telegram: string | null`, and use it in the template instead of `user_telegram`:
```
a [href]="'https://t.me/' + c.owner_telegram"
```

- [ ] **Step 3: Add route**

```typescript
  { path: 'my-claims', loadComponent: () => import('./pages/my-claims/my-claims').then(m => m.MyClaims), canActivate: [authGuard] },
```

- [ ] **Step 4: Commit**

```bash
git add backend/items/serializers.py frontend/src/app/pages/my-claims/ frontend/src/app/interfaces/claim.interface.ts frontend/src/app/app.routes.ts
git commit -m "feat(claims): My Claims page with telegram reveal"
```

---

### Task 4.5: Item detail — edit/delete (owner), withdraw claim (claimant), telegram reveal

**Files:**
- Modify: `frontend/src/app/pages/item-detail/item-detail.ts`

- [ ] **Step 1: Update item-detail component**

Read the existing file, then make these changes:

1. Inside the template, add owner actions block (near the edit/delete position — right under the title):

```html
@if (isOwner) {
  <div class="flex gap-2 mb-4">
    <button (click)="startEdit()" class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50">Edit</button>
    <button (click)="remove()" class="px-3 py-1.5 text-sm bg-white border border-red-300 text-red-600 rounded-md hover:bg-red-50">Delete</button>
  </div>
}
```

2. In the claims list block, for a row where `claim.status === 'APPROVED'` and the current user is the owner, show a telegram link:

```html
@if (claim.status === 'APPROVED' && claim.user_telegram) {
  <a [href]="'https://t.me/' + claim.user_telegram" target="_blank" class="text-sm text-blue-600 hover:underline">
    Contact on Telegram ▶
  </a>
}
```

3. For the claimant viewing their own approved claim on this item, show owner telegram (use `item.owner_telegram`):

```html
@if (item.owner_telegram) {
  <a [href]="'https://t.me/' + item.owner_telegram" target="_blank" class="inline-block mt-2 text-sm text-blue-600 hover:underline">
    Contact owner on Telegram ▶
  </a>
}
```

4. For users with a `PENDING` claim on this item, show a "Withdraw" button:

```html
@if (myPendingClaim) {
  <button (click)="withdraw()" class="mt-2 text-sm text-red-600 hover:underline">
    Withdraw my claim
  </button>
}
```

5. In the class body, add:

```typescript
  get myPendingClaim() {
    const me = this.auth.currentUser;
    if (!me || !this.item) return null;
    return this.item.claims?.find(c => c.user === me.id && c.status === 'PENDING') ?? null;
  }

  remove() {
    if (!confirm('Delete this item?')) return;
    this.itemService.deleteItem(this.item!.id).subscribe(() => this.router.navigate(['/my-items']));
  }

  startEdit() {
    this.router.navigate(['/items', this.item!.id, 'edit']);
  }

  withdraw() {
    const c = this.myPendingClaim;
    if (!c) return;
    this.claimService.withdraw(c.id).subscribe(() => this.loadItem());
  }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/pages/item-detail/item-detail.ts
git commit -m "feat(item): edit/delete, withdraw, telegram reveal"
```

---

### Task 4.6: Item edit page

**Files:**
- Create: `frontend/src/app/pages/item-edit/item-edit.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Create component**

```typescript
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ItemService } from '../../services/item.service';
import { CategoryService } from '../../services/category.service';
import { Item } from '../../interfaces/item.interface';
import { Category } from '../../interfaces/category.interface';
import { ImageUpload } from '../../components/image-upload/image-upload';

@Component({
  selector: 'app-item-edit',
  standalone: true,
  imports: [FormsModule, RouterLink, ImageUpload],
  template: `
    <div class="max-w-xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Edit item</h1>
      @if (error()) { <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error() }}</div> }
      @if (item) {
        <div class="space-y-4 bg-white rounded-lg border border-gray-200 p-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input [(ngModel)]="item.title" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea [(ngModel)]="item.description" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select [(ngModel)]="item.category" class="w-full px-3 py-2 border border-gray-300 rounded-md">
              @for (cat of categories; track cat.id) {
                <option [ngValue]="cat.id">{{ cat.icon }} {{ cat.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input [(ngModel)]="item.location" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Photo</label>
            <app-image-upload kind="item" [existingUrl]="item.image" (uploaded)="imageKey = $event"></app-image-upload>
          </div>
          <div class="pt-2">
            <button (click)="save()" [disabled]="saving()" class="px-4 py-2 bg-gray-900 text-white rounded-md disabled:opacity-50">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
            <a [routerLink]="['/items', item.id]" class="ml-3 text-sm text-gray-600">Cancel</a>
          </div>
        </div>
      }
    </div>
  `,
})
export class ItemEdit implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private itemService = inject(ItemService);
  private categoryService = inject(CategoryService);

  item: Item | null = null;
  categories: Category[] = [];
  imageKey: string | null = null;
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.categoryService.list().subscribe(cs => this.categories = cs);
    this.itemService.getItem(id).subscribe(item => {
      this.item = item;
      this.imageKey = item.image_key;
    });
  }

  save() {
    if (!this.item) return;
    this.saving.set(true);
    this.itemService.updateItem(this.item.id, {
      title: this.item.title,
      description: this.item.description,
      item_type: this.item.item_type,
      category: this.item.category,
      location: this.item.location,
      image: this.imageKey,
    }).subscribe({
      next: () => { this.saving.set(false); this.router.navigate(['/items', this.item!.id]); },
      error: err => { this.saving.set(false); this.error.set(err.error?.detail || 'Save failed.'); },
    });
  }
}
```

- [ ] **Step 2: Update `Item` interface**

In `frontend/src/app/interfaces/item.interface.ts`, add:
```typescript
  image_key: string | null;
  owner_telegram: string | null;
  pending_claims_count: number;
```
Change `status: 'OPEN' | 'CLAIMED' | 'RESOLVED'` → `status: 'OPEN' | 'RESOLVED'`.

- [ ] **Step 3: Add route**

```typescript
  { path: 'items/:id/edit', loadComponent: () => import('./pages/item-edit/item-edit').then(m => m.ItemEdit), canActivate: [authGuard] },
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/item-edit/ frontend/src/app/interfaces/item.interface.ts frontend/src/app/app.routes.ts
git commit -m "feat(item): edit page"
```

---

### Task 4.7: My Items enhancements — pending count + delete

**Files:**
- Modify: `frontend/src/app/pages/my-items/my-items.ts`

- [ ] **Step 1: In the existing template, add pending count + delete button per item**

Near each item's actions area:

```html
<div class="flex items-center gap-3 mt-2">
  <a [routerLink]="['/items', item.id, 'edit']" class="text-sm text-gray-600 hover:underline">Edit</a>
  <button (click)="delete(item)" class="text-sm text-red-600 hover:underline">Delete</button>
  @if (item.pending_claims_count > 0) {
    <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-800">
      {{ item.pending_claims_count }} pending
    </span>
  }
</div>
```

In class:
```typescript
  delete(item: Item) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    this.itemService.deleteItem(item.id).subscribe(() => {
      this.items = this.items.filter(i => i.id !== item.id);
    });
  }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/pages/my-items/my-items.ts
git commit -m "feat(my-items): delete + pending badge"
```

---

### Task 4.8: NotificationBell component

**Files:**
- Create: `frontend/src/app/components/notification-bell/notification-bell.ts`

- [ ] **Step 1: Create component**

```typescript
import { Component, HostListener, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink],
  template: `
    <div class="relative">
      <button (click)="toggle($event)" class="relative p-2 rounded-md hover:bg-gray-100">
        <svg class="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 20a2 2 0 004 0" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        @if ((notifications.unreadCount$ | async) as n) {
          @if (n > 0) {
            <span class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
              {{ n > 99 ? '99+' : n }}
            </span>
          }
        }
      </button>

      @if (open()) {
        <div class="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span class="font-medium">Notifications</span>
            <button (click)="markAll()" class="text-xs text-gray-500 hover:text-gray-700">Mark all read</button>
          </div>
          <div class="max-h-96 overflow-y-auto">
            @for (n of (notifications.list$ | async) ?? []; track n.id) {
              <a [routerLink]="['/items', n.item]" (click)="markRead(n.id)"
                 [class.bg-blue-50]="!n.read_at"
                 class="block px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
                <div class="text-sm">{{ summary(n.kind, n.actor_username, n.item_title) }}</div>
                <div class="text-xs text-gray-400 mt-1">{{ n.created_at | date:'short' }}</div>
              </a>
            } @empty {
              <div class="px-4 py-8 text-center text-sm text-gray-400">No notifications</div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class NotificationBell {
  notifications = inject(NotificationService);
  open = signal(false);

  toggle(ev: Event) { ev.stopPropagation(); this.open.update(v => !v); }

  @HostListener('document:click') closeOnOutside() { this.open.set(false); }

  summary(kind: string, actor: string | null, itemTitle: string): string {
    const a = actor ?? 'Someone';
    switch (kind) {
      case 'CLAIM_CREATED':   return `${a} claimed your "${itemTitle}"`;
      case 'CLAIM_APPROVED':  return `Your claim on "${itemTitle}" was approved`;
      case 'CLAIM_REJECTED':  return `Your claim on "${itemTitle}" was rejected`;
      case 'CLAIM_WITHDRAWN': return `${a} withdrew their claim on "${itemTitle}"`;
      default: return 'Notification';
    }
  }

  markRead(id: number) { this.notifications.markRead(id).subscribe(); }
  markAll() { this.notifications.markAllRead().subscribe(); }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/notification-bell/
git commit -m "feat(notifications): bell + dropdown"
```

---

### Task 4.9: Admin Panel page

**Files:**
- Create: `frontend/src/app/pages/admin-panel/admin-panel.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Create component**

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { CategoryService } from '../../services/category.service';
import { ItemService } from '../../services/item.service';
import { StatsService } from '../../services/stats.service';
import { Category } from '../../interfaces/category.interface';
import { Item } from '../../interfaces/item.interface';

type Tab = 'categories' | 'items' | 'stats';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="max-w-5xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Admin Panel</h1>
      <nav class="flex gap-1 mb-6 border-b border-gray-200">
        @for (t of tabs; track t) {
          <button (click)="tab.set(t)"
            class="px-4 py-2 text-sm font-medium border-b-2 capitalize"
            [class.border-gray-900]="tab() === t"
            [class.text-gray-900]="tab() === t"
            [class.border-transparent]="tab() !== t"
            [class.text-gray-500]="tab() !== t">{{ t }}</button>
        }
      </nav>

      @switch (tab()) {
        @case ('categories') {
          <section class="space-y-4">
            <div class="flex gap-2">
              <input [(ngModel)]="newCat.name" placeholder="Name" class="px-3 py-2 border border-gray-300 rounded-md" />
              <input [(ngModel)]="newCat.icon" placeholder="Icon (emoji)" class="w-24 px-3 py-2 border border-gray-300 rounded-md" />
              <button (click)="addCat()" class="px-4 py-2 bg-gray-900 text-white rounded-md">Add</button>
            </div>
            <ul class="divide-y divide-gray-100 border border-gray-200 rounded-md">
              @for (c of cats(); track c.id) {
                <li class="flex items-center gap-4 px-4 py-3">
                  <span class="text-2xl">{{ c.icon }}</span>
                  <span class="flex-1">{{ c.name }}</span>
                  <button (click)="deleteCat(c)" class="text-sm text-red-600 hover:underline">Delete</button>
                </li>
              }
            </ul>
          </section>
        }
        @case ('items') {
          <section class="space-y-4">
            <div class="flex gap-2 items-center">
              <select [(ngModel)]="filter.status" (change)="loadItems()" class="px-3 py-2 border border-gray-300 rounded-md">
                <option value="">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
              </select>
              <select [(ngModel)]="filter.type" (change)="loadItems()" class="px-3 py-2 border border-gray-300 rounded-md">
                <option value="">All types</option>
                <option value="LOST">Lost</option>
                <option value="FOUND">Found</option>
              </select>
            </div>
            <div class="space-y-2">
              @for (it of items(); track it.id) {
                <div class="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md">
                  <div class="flex-1">
                    <div class="text-sm font-medium">[{{ it.item_type }}] {{ it.title }}</div>
                    <div class="text-xs text-gray-500">{{ it.username }} · {{ it.status }} · {{ it.created_at | date:'short' }}</div>
                  </div>
                  @if (it.status !== 'RESOLVED') {
                    <button (click)="forceResolve(it)" class="text-sm text-yellow-700 hover:underline">Force resolve</button>
                  }
                  <button (click)="deleteItem(it)" class="text-sm text-red-600 hover:underline">Delete</button>
                </div>
              }
            </div>
          </section>
        }
        @case ('stats') {
          @if (stats()) {
            <section class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Total items</div><div class="text-2xl font-semibold">{{ stats()!.total_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Open</div><div class="text-2xl font-semibold">{{ stats()!.open_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Resolved</div><div class="text-2xl font-semibold">{{ stats()!.resolved_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Lost (active)</div><div class="text-2xl font-semibold">{{ stats()!.lost_active }}</div></div>
            </section>
          }
        }
      }
    </div>
  `,
})
export class AdminPanel implements OnInit {
  private admin = inject(AdminService);
  private categoryService = inject(CategoryService);
  private statsService = inject(StatsService);

  tabs: Tab[] = ['categories', 'items', 'stats'];
  tab = signal<Tab>('categories');

  cats = signal<Category[]>([]);
  newCat = { name: '', icon: '' };

  items = signal<Item[]>([]);
  filter = { status: '', type: '' };

  stats = signal<any | null>(null);

  ngOnInit() {
    this.loadCats();
    this.loadItems();
    this.statsService.get().subscribe(s => this.stats.set(s));
  }

  loadCats() { this.categoryService.list().subscribe(cs => this.cats.set(cs)); }
  addCat() {
    if (!this.newCat.name || !this.newCat.icon) return;
    this.admin.createCategory(this.newCat).subscribe(() => { this.newCat = { name: '', icon: '' }; this.loadCats(); });
  }
  deleteCat(c: Category) {
    if (!confirm(`Delete "${c.name}"? Items in this category will also be deleted.`)) return;
    this.admin.deleteCategory(c.id).subscribe(() => this.loadCats());
  }

  loadItems() {
    this.admin.listItems({
      status: this.filter.status || undefined,
      type: this.filter.type || undefined,
    }).subscribe(res => this.items.set(res.results));
  }
  forceResolve(it: Item) {
    this.admin.forceResolve(it.id).subscribe(() => this.loadItems());
  }
  deleteItem(it: Item) {
    if (!confirm(`Delete "${it.title}"?`)) return;
    this.admin.deleteItem(it.id).subscribe(() => this.loadItems());
  }
}
```

- [ ] **Step 2: Add route**

In `app.routes.ts`, add import `import { adminGuard } from './guards/admin.guard';` then:

```typescript
  { path: 'admin-panel', loadComponent: () => import('./pages/admin-panel/admin-panel').then(m => m.AdminPanel), canActivate: [authGuard, adminGuard] },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/pages/admin-panel/ frontend/src/app/app.routes.ts
git commit -m "feat(admin): admin panel with categories/items/stats tabs"
```

---

### Task 4.10: Header redesign + notification bell wiring

**Files:**
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.ts` (imports)

- [ ] **Step 1: Read current `app.html`** then replace with redesigned header:

```html
<header class="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-200">
  <div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
    <a routerLink="/feed" class="flex items-center gap-2 font-semibold text-gray-900">
      <span class="inline-block w-7 h-7 rounded-md bg-gray-900 text-white flex items-center justify-center text-sm">LF</span>
      <span class="hidden sm:inline">Lost &amp; Found</span>
    </a>

    <nav class="flex-1 flex items-center gap-1 text-sm">
      <a routerLink="/feed" routerLinkActive="text-gray-900 bg-gray-100" class="px-3 py-1.5 rounded-md text-gray-600 hover:text-gray-900">Feed</a>
      @if (isLoggedIn$ | async) {
        <a routerLink="/post" routerLinkActive="text-gray-900 bg-gray-100" class="px-3 py-1.5 rounded-md text-gray-600 hover:text-gray-900">Post</a>
        <a routerLink="/my-items" routerLinkActive="text-gray-900 bg-gray-100" class="px-3 py-1.5 rounded-md text-gray-600 hover:text-gray-900">My items</a>
        <a routerLink="/my-claims" routerLinkActive="text-gray-900 bg-gray-100" class="px-3 py-1.5 rounded-md text-gray-600 hover:text-gray-900">My claims</a>
      }
      @if (isAdmin$ | async) {
        <a routerLink="/admin-panel" routerLinkActive="text-gray-900 bg-gray-100" class="px-3 py-1.5 rounded-md text-yellow-800 hover:text-yellow-900">Admin</a>
      }
    </nav>

    <div class="flex items-center gap-2">
      @if (isLoggedIn$ | async) {
        <app-notification-bell></app-notification-bell>
        <a routerLink="/profile" class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-100">
          @if ((currentUser$ | async)?.avatar) {
            <img [src]="(currentUser$ | async)?.avatar" class="w-7 h-7 rounded-full object-cover" />
          } @else {
            <span class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">
              {{ ((currentUser$ | async)?.username ?? '?').charAt(0).toUpperCase() }}
            </span>
          }
          <span class="hidden sm:inline text-sm text-gray-700">{{ (currentUser$ | async)?.username }}</span>
        </a>
        <button (click)="logout()" class="text-sm text-gray-500 hover:text-gray-700 px-2 py-1">Log out</button>
      } @else {
        <a routerLink="/login" class="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5">Log in</a>
        <a routerLink="/register" class="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-800">Sign up</a>
      }
    </div>
  </div>
</header>

<main class="max-w-6xl mx-auto">
  <router-outlet></router-outlet>
</main>
```

- [ ] **Step 2: Update `app.ts`**

Add imports and expose `isAdmin$`:

```typescript
import { NotificationBell } from './components/notification-bell/notification-bell';
// ...
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, NotificationBell],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private auth = inject(AuthService);
  private router = inject(Router);

  currentUser$ = this.auth.currentUser$;
  isLoggedIn$ = this.auth.isLoggedIn$;
  isAdmin$ = this.auth.isAdmin$;

  constructor() { this.auth.loadUser(); }
  logout() { this.auth.logout().subscribe(() => this.router.navigate(['/feed'])); }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/app.html frontend/src/app/app.ts
git commit -m "feat(ui): redesigned header with bell, profile, admin link"
```

---

### Task 4.11: UI polish pass — empty/loading states + spacing pass

**Files:**
- Modify: `frontend/src/app/pages/feed/feed.ts`
- Modify: `frontend/src/app/pages/my-items/my-items.ts`
- Modify: `frontend/src/app/pages/item-detail/item-detail.ts`

- [ ] **Step 1: Invoke design skills** for guidance

Before editing, run the `frontend-design` and `ui-ux-pro-max` skills:
- `Skill: frontend-design` — for interactive state patterns
- `Skill: ui-ux-pro-max` — for spacing, typography, cards

- [ ] **Step 2: Feed — skeleton cards while loading, empty-state illustration**

In `feed.ts` template, replace the `@if (loading)` block:

```html
@if (loading) {
  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
    @for (_ of [1,2,3,4,5,6]; track $index) {
      <div class="rounded-lg bg-white border border-gray-200 overflow-hidden animate-pulse">
        <div class="h-40 bg-gray-100"></div>
        <div class="p-4 space-y-2">
          <div class="h-4 bg-gray-100 rounded w-3/4"></div>
          <div class="h-3 bg-gray-100 rounded w-1/2"></div>
        </div>
      </div>
    }
  </div>
} @else if (items.length === 0) {
  <div class="mt-12 text-center py-16 px-4 bg-white border border-dashed border-gray-300 rounded-lg">
    <div class="text-5xl mb-3">🔎</div>
    <h3 class="text-lg font-medium text-gray-900">Nothing here yet</h3>
    <p class="text-sm text-gray-500 mt-1">Try a different filter or be the first to post.</p>
  </div>
}
```

- [ ] **Step 3: My items — empty state**

Similar treatment for `my-items.ts`.

- [ ] **Step 4: Item detail — ensure image error fallback**

In `item-detail.ts` template, add `(error)="$event.target.style.display='none'"` to the `<img>`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/pages/
git commit -m "style(ui): skeletons + empty states + image fallback"
```

---

## Phase 5 — Final verification

### Task 5.1: End-to-end smoke test

Not a code change — a manual verification flow.

- [ ] **Step 1: Full rebuild**

```bash
docker compose down -v
docker compose up --build -d
docker compose exec backend python manage.py loaddata categories
docker compose exec backend python manage.py createsuperuser
```

- [ ] **Step 2: Browser flow (as user A — regular)**

1. Register user A → logged in. Land on feed.
2. Go to Profile → set telegram `testA` → save.
3. Go to Post → fill title, description, category, upload an image (JPG) → submit → redirected to feed.
4. Confirm the item appears with the uploaded photo (presigned URL loads).
5. Log out.

- [ ] **Step 3: Browser flow (as user B — regular)**

1. Register user B. Set telegram `testB`.
2. Open the item from user A. Submit a claim.
3. Bell shows 0 (B is the claimant, not recipient).
4. Go to My Claims — see pending claim.
5. Log out.

- [ ] **Step 4: Back to user A**

1. Log in. Bell shows **1** unread notification ("testB claimed your ...").
2. Open notification → lands on item detail. Claim visible.
3. Approve the claim.
4. Item status now RESOLVED. Claim row shows Telegram link `https://t.me/testB`.
5. Log out.

- [ ] **Step 5: User B again**

1. Log in. Bell shows **1** ("Your claim was approved").
2. Open My Claims → approved. "Contact owner on Telegram" link points at `https://t.me/testA`.

- [ ] **Step 6: Admin flow**

1. Log in as superuser (is_staff=True).
2. `/admin-panel` is reachable. Add a category. Delete a category.
3. Items tab: filter by status, force-resolve a test item, delete a test item.

- [ ] **Step 7: Withdraw flow**

1. As user C, claim user A's new test item.
2. Before user A acts — user C goes to item detail → Withdraw. Claim gone.
3. User A sees "testC withdrew their claim" notification.

- [ ] **Step 8: Duplicate claim**

1. User C claims same item again → works (no pending existed).
2. User C tries to claim twice in a row → 400 "You already have a pending claim".

- [ ] **Step 9: Commit verification notes** (if any README updates were made)

```bash
git status
```
No commit needed if all verification passed without code changes.

---

## Spec coverage map

- §3 D1 claim state machine → Tasks 1.6, 2.6, 2.7
- §3 D2 uploads/storage → Tasks 1.1, 1.2, 1.3, 1.4, 3.4, 4.1, 4.2, 4.6
- §3 D3 notifications → Tasks 1.8, 2.1, 2.2, 3.5, 4.8, 4.10
- §3 D4 contact reveal → Tasks 2.3, 2.4, 4.4, 4.5
- §3 D5 admin → Tasks 2.10, 2.11, 2.12, 3.2, 3.3, 3.6, 4.9, 4.10
- §3 D6 withdraw → Tasks 2.8, 3.7, 4.5
- §3 D7 unique constraint → Task 1.5, 2.6
- §4 data model → Tasks 1.5, 1.6, 1.8
- §5 API contract → Phase 2 tasks
- §6 frontend changes → Phase 3, 4
- §7 storage flow → Tasks 1.1–1.4, 3.4, 4.1
- §8 security → accepted risks documented
- §9 migration/rollout → Task 5.1
