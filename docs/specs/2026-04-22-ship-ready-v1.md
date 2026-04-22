# Spec: Lost & Found — Ship-Ready v1

**Date:** 2026-04-22
**Status:** Approved for implementation
**Owner:** Alibek (backend) + teammate (frontend)

---

## 1. Context

Lost & Found is a campus platform for posting lost/found items and claiming them. The MVP works end-to-end but has real gaps blocking ship:

- Image upload UX is fake (a text field accepting arbitrary URLs). MinIO is running but never written to.
- Claim model allows a single user to spam-claim the same item.
- Claim state machine is incoherent (`CLAIMED` is set on first claim, then nothing).
- Claimants can't withdraw their own claims.
- No profile page — `phone`, `avatar`, `telegram` exist on the model but have no UI.
- No notifications — nobody knows when a claim was submitted/approved/rejected.
- No contact reveal — when a claim is approved, owner and claimant can't reach each other.
- No admin UI beyond Django's — admins can't manage categories in the app itself.
- No edit/delete item UI (PUT/DELETE endpoints exist but aren't wired up).
- Claimants have no "My Claims" view.
- Header and overall design quality is weak.

This spec ships **all of the above** together as v1.

## 2. Goals & Non-Goals

### Goals
1. Users can upload photos directly from the browser to object storage; photos are viewed via time-limited presigned URLs.
2. Claim semantics are coherent, abuse-resistant, and reversible.
3. Profile data (name, telegram, phone, avatar) is editable from the UI.
4. Owners and claimants get in-app notifications (HTTP polling, no websockets).
5. When a claim is approved, both parties can reach each other via a Telegram deeplink.
6. Admins (`is_staff`) can manage categories and moderate items from the frontend.
7. The user flow is complete: edit/delete items, view own items, view own claims.
8. Visual polish: redesigned header, consistent spacing, empty/loading states.

### Explicit Non-Goals
- Automated tests (backend or frontend)
- OpenAPI / Swagger docs
- Email verification, password reset
- Rate limiting, `ALLOWED_HOSTS` hardening, other prod security work
- Websockets / realtime / push notifications
- Category `on_delete` change (remains `CASCADE`)
- i18n / translation
- Mobile apps

## 3. Decisions

### D1. Claim state machine — simplified to two states
**Decision:** Drop `CLAIMED`. `Item.status` is only `OPEN` or `RESOLVED`.
- `OPEN`: default. Item can receive new claims.
- `RESOLVED`: an owner approved one claim. Item is closed. No new claims accepted.
- Pending claim count is a **derived value** (serializer annotation), not a stored status.
- Rejecting a claim does **not** touch `Item.status` (it stays `OPEN` regardless of how many claims remain pending). **`approve_reject_view` at `backend/items/views.py:155-163` must be rewritten** to drop the "back to OPEN if no pending" branch.
- Approving a claim → `Item.status = RESOLVED`. When an item is resolved, **remaining `PENDING` claims on that item are auto-transitioned to `REJECTED`** in the same transaction (so claimants don't sit in limbo and `CLAIM_REJECTED` notifications fire for them). The approve handler does this.

**Rationale:** The `CLAIMED` state denormalized data that could drift and didn't block anything meaningful. Two-state model matches real flow: item is open until the owner picks a winner.

**Migration:** all existing `CLAIMED` items become `OPEN`.

### D2. Object storage — private bucket, presigned both directions
- MinIO bucket becomes **private**:
  - Remove `mc anonymous set download …` from the `createbucket` compose step.
  - In `config/settings.py`: **delete** `AWS_DEFAULT_ACL = 'public-read'`, **flip** `AWS_QUERYSTRING_AUTH = True`, and keep `AWS_S3_FILE_OVERWRITE = False`.
- **Dual endpoint configuration** (required — without this, the browser cannot reach MinIO):
  - `AWS_S3_ENDPOINT_URL_INTERNAL` — for backend → MinIO (docker network): `http://minio:9000`
  - `AWS_S3_ENDPOINT_URL_PUBLIC` — for signed URLs the browser uses: `http://localhost:29000` (dev) / real S3 hostname (prod)
  - Presign code creates a second `boto3` client whose `endpoint_url=AWS_S3_ENDPOINT_URL_PUBLIC` and uses it for `generate_presigned_url` only. The default client (for any server-side writes) uses the internal endpoint.
- **Upload (presigned PUT):**
  - Server validates `content_type ∈ {image/jpeg, image/png, image/webp}` and pins that exact value into the signature via boto3's `ContentType` param. Client **must** send the identical `Content-Type` header on the PUT — mismatches break the SigV4 signature. `UploadService` sets this explicitly.
  - Presigned URL TTL: 10 minutes.
- **View (presigned GET):**
  - When the backend serializes any `image`/`avatar`, it calls `generate_presigned_url('get_object', Key=key, ExpiresIn=3600)` via the public-endpoint client and returns that URL in the response.
  - **Legacy data handling:** serializer function treats any stored value starting with `http://` or `https://` as a pre-existing full URL and returns it unchanged (no signing). The migration in §9 simply leaves legacy rows alone; new rows store only object keys.
- What's stored in the DB: the **object key** (e.g. `items/abc123.jpg`). Serializer converts key → presigned URL on output.
- **CORS on MinIO:** `createbucket` step runs `mc anonymous` is **removed** and replaced with a CORS policy allowing `PUT, GET, HEAD` from every origin in `CORS_ALLOWED_ORIGINS`, `AllowedHeaders: ["*"]`, `ExposeHeaders: ["ETag"]`.

**Rationale:** User explicitly asked for both ("upload directly from web to S3" + "presigned URLs to see photos"). Presigned GET gives us revocable access and a clean path to private content later.

### D3. Notifications — DB model, HTTP polling
- New `Notification` model.
- Frontend polls `GET /api/notifications/` every 30 seconds while the user is authenticated. Stops when tab hidden (`document.visibilitychange`).
- Bell icon in header with unread count. Dropdown shows latest 20.
- Triggers:
  - Someone claimed my item → notify owner
  - My claim was approved → notify claimant (include telegram link)
  - My claim was rejected → notify claimant
  - Someone withdrew their claim on my item → notify owner
- `PATCH /api/notifications/:id/read/` marks one read; `POST /api/notifications/read-all/` marks all read.

### D4. Contact reveal — Telegram deeplink on approved claim
- When a claim transitions to `APPROVED`:
  - Owner sees the claimant's `profile.telegram` on the item detail page (in the claim row) as a clickable link: `https://t.me/{telegram}`.
  - Claimant sees the owner's `profile.telegram` on the item detail page and in the "claim approved" notification.
- **Telegram handle normalization** (applied on profile save and on read):
  - Trim whitespace.
  - Strip leading `@`.
  - Strip leading `https://t.me/` or `t.me/`.
  - Validate regex `^[a-zA-Z0-9_]{5,32}$` on save; reject with 400 if invalid.
- If either side has no telegram set, show "No Telegram — add one in your profile" message to that user.
- Phone is **not** shown (profile field exists for future use; not in v1).

### D5. Admin role — `is_staff` gating + `/admin-panel` route
- Use Django's built-in `User.is_staff`. `/me/` returns `is_staff: bool`. Update points:
  - `accounts/views.py` `_user_data()` — add `is_staff`
  - `accounts/serializers.py` — n/a (already raw dict)
  - `frontend/src/app/interfaces/user.interface.ts` `User` interface — add `is_staff: boolean`
  - `frontend/src/app/services/auth.service.ts` — add `isAdmin$ = currentUser$.pipe(map(u => !!u?.is_staff))`
- Frontend route `/admin-panel` guarded by `adminGuard` (checks `is_staff`). Server-side `IsAdminUser` (DRF built-in) enforces on every admin endpoint — **frontend gating is convenience only**.
- Admins can:
  - `POST/PATCH/DELETE /api/categories/` — manage categories
  - `DELETE /api/items/:id/` on any item (moderation) — extend permission check in `item_detail_view` to allow `request.user.is_staff OR item.user == request.user`
  - `POST /api/items/:id/force-resolve/` — see below
  - `GET /api/admin/items/` — **dedicated admin-scoped list endpoint** (new). Returns all items regardless of status with expanded claimant info, filters `?status=`, `?type=`, `?user_id=`. Paginated. Needed because the public `/api/items/` is user-facing and we don't want to leak admin filters there.
- **`force-resolve` semantics:**
  - Rejects item if already `RESOLVED` (400).
  - Sets `Item.status = RESOLVED`.
  - Auto-transitions every `PENDING` claim on that item to `REJECTED` (same as the approve-cascade in D1).
  - Emits `CLAIM_REJECTED` to each claimant of those claims.
- Admin panel UI has three tabs: **Categories**, **Items** (with filters + moderation actions), **Stats** (reuses `/stats`).

### D6. Withdraw claim — `DELETE /api/claims/:id/`
- Claimant can delete their own claim only if its status is `PENDING`.
- Cannot withdraw `APPROVED` or `REJECTED` claims.
- Deleting the last pending claim does **not** change `Item.status` (since status doesn't depend on claim count under D1).

### D7. Unique constraint — one pending claim per (user, item)
- Instead of a raw `UNIQUE(user_id, item_id)` (which would block a user from re-claiming after their own withdrawal or the owner's rejection), use a **partial unique index** (Postgres-specific — matches our DB):
  - `UniqueConstraint(fields=['user', 'item'], condition=Q(status='PENDING'), name='unique_pending_claim_per_user_item')`
- A user can have at most **one pending** claim on a given item. They can re-claim after withdrawing or being rejected.
- `create_claim_view` wraps the `serializer.save(...)` call in `try/except IntegrityError` and returns `400 {"detail": "You already have a pending claim on this item."}`.

## 4. Data Model Changes

### `items.Item`
- `status` choices: `OPEN`, `RESOLVED` (drop `CLAIMED`)
- `image`: stays `CharField(max_length=500, blank=True, null=True)`, now stores **object key** (e.g. `items/uuid.jpg`), not a URL.
- Migration data step: `UPDATE items_item SET status='OPEN' WHERE status='CLAIMED'`.

### `items.Claim`
- New `Meta.constraints`:
  ```python
  UniqueConstraint(
      fields=['user', 'item'],
      condition=Q(status='PENDING'),
      name='unique_pending_claim_per_user_item',
  )
  ```

### `accounts.Profile`
- `avatar`: stays `CharField(max_length=500, blank=True, null=True)`, now stores **object key**.

### `notifications.Notification` (new app)
- Add `'notifications'` to `INSTALLED_APPS` in `config/settings.py`.
- Add `path('api/notifications/', include('notifications.urls'))` in `config/urls.py`.
- `Notification.item` is **non-nullable** — every current trigger has an associated item. `on_delete=CASCADE` cleans up notifications when an item is deleted.
```python
class Notification(models.Model):
    class Kind(models.TextChoices):
        CLAIM_CREATED   = 'CLAIM_CREATED',   'Claim created'
        CLAIM_APPROVED  = 'CLAIM_APPROVED',  'Claim approved'
        CLAIM_REJECTED  = 'CLAIM_REJECTED',  'Claim rejected'
        CLAIM_WITHDRAWN = 'CLAIM_WITHDRAWN', 'Claim withdrawn'

    recipient   = ForeignKey(User, on_delete=CASCADE, related_name='notifications')
    actor       = ForeignKey(User, on_delete=SET_NULL, null=True, related_name='+')
    kind        = CharField(max_length=20, choices=Kind.choices)
    item        = ForeignKey('items.Item', on_delete=CASCADE)
    claim       = ForeignKey('items.Claim', on_delete=SET_NULL, null=True)
    read_at     = DateTimeField(null=True, blank=True)
    created_at  = DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [Index(fields=['recipient', 'read_at'])]
```

## 5. API Contract — Changes & Additions

### New endpoints

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `/api/uploads/presign/` | ✓ | `{ "kind": "item" \| "avatar", "content_type": "image/jpeg" }` | `{ "upload_url": "...", "object_key": "items/<uuid>.jpg", "expires_in": 600 }` |
| DELETE | `/api/claims/:id/` | ✓ owner of claim | — | `204` (only if `status=PENDING`, else `400`) |
| POST | `/api/items/:id/force-resolve/` | ✓ admin | — | updated item |
| POST | `/api/categories/` | ✓ admin | `{name, icon}` | created category |
| PATCH | `/api/categories/:id/` | ✓ admin | `{name?, icon?}` | updated |
| DELETE | `/api/categories/:id/` | ✓ admin | — | `204` |
| GET | `/api/notifications/` | ✓ | `?unread_only=true&?limit=20` | `{ results: [...], unread_count: N }` — **see pagination note** |
| PATCH | `/api/notifications/:id/read/` | ✓ recipient | — | updated notification |
| POST | `/api/notifications/read-all/` | ✓ | — | `{ unread_count: 0 }` |
| GET | `/api/admin/items/` | ✓ admin | `?status=&type=&user_id=&page=` | DRF-paginated admin item list |
| GET | `/api/claims/my/` | ✓ | — | list of the current user's claims (with nested `item` summary) |

**Pagination note for `/api/notifications/`:** set `pagination_class = None` on this view and slice manually (`queryset[:limit]`) so we can return the custom `{ results, unread_count }` shape. `unread_count` is computed independently of `unread_only` — always the total count of unread notifications for the recipient.

### Modified endpoints

- `GET /api/auth/me/` — now returns `is_staff: bool`
- `POST /api/items/:id/claims/` — **no longer** flips `Item.status` to `CLAIMED`. Enforces partial unique constraint (returns 400 on duplicate pending claim).
- `PATCH /api/claims/:id/approve/` — sets claim to `APPROVED`, item to `RESOLVED`. Emits `CLAIM_APPROVED` notification.
- `PATCH /api/claims/:id/reject/` — sets claim to `REJECTED`. Does **not** touch `Item.status`. Emits `CLAIM_REJECTED` notification.
- `DELETE /api/items/:id/` — now also allowed for `is_staff`.
- All serializers that expose `image` or `avatar` now return **presigned GET URLs** (generated on read). Legacy full-URL values are returned unchanged.
- `ItemSerializer` adds `pending_claims_count` (int, annotated).
- `ClaimSerializer` adds `user_telegram` field — present only when the claim is `APPROVED` AND the requesting user is one of {claim owner, item owner}; otherwise `null`. **Every view that instantiates `ClaimSerializer` / `ItemSerializer` must pass `context={'request': request}`** (today they do not — see `items/views.py:107, 133, 165` — this is a required change).
- `ProfileSerializer` / `_user_data` add `is_staff: bool` on the user and transform `avatar` through presigned GET.

### Notification emission rules (backend)
- On `create_claim_view` success → create `CLAIM_CREATED` for `item.user`.
- On `approve_reject_view` action=`approve` → create `CLAIM_APPROVED` for `claim.user`.
- On `approve_reject_view` action=`reject` → create `CLAIM_REJECTED` for `claim.user`.
- On `DELETE /api/claims/:id/` → create `CLAIM_WITHDRAWN` for `claim.item.user`.

## 6. Frontend Changes

### New routes
- `/profile` — edit profile (auth required)
- `/my-claims` — list of claims I submitted (auth required)
- `/admin-panel` — admin-only (adminGuard)

### Modified routes
- `/items/:id` — add edit/delete buttons for owner, telegram link on approved claim
- `/my-items` — add edit/delete buttons; show pending claims count
- `/post` — replace URL-text-field with file picker (uses presigned PUT flow)

### New components (high level)
- `ImageUpload` — reusable. Accepts a file, gets presigned URL, PUTs to MinIO, reports back the `object_key`. Used by post-item, profile (avatar), item edit.
- `NotificationBell` — in header. Polls every 30s while tab visible. Dropdown with list + mark-read actions.
- `Header` (redesigned) — new layout per design polish.
- `AdminPanel` — tabs: Categories, Items, Stats.

### AuthService updates
- `User` interface adds `is_staff: boolean`.
- New `isAdmin$` observable.

### New services
- `UploadService` — single method `upload(file, kind): Observable<{object_key: string}>` that handles presign + PUT.
- `NotificationService` — `list$`, `unreadCount$`, `markRead()`, `markAllRead()`, internal 30s poller with visibility gating.
- `AdminService` — category CRUD, moderation actions.

### Design polish
- Use `frontend-design` and `ui-ux-pro-max` skills during implementation of header, profile, admin panel, notification dropdown.
- Empty states for feed / my-items / my-claims / notifications.
- Loading states (skeletons preferred over spinners).
- Consistent Tailwind spacing (4/6/8 scale), consistent rounded-md/lg.

## 7. Storage & Upload Flow

### Presign request
```
POST /api/uploads/presign/
{ "kind": "item", "content_type": "image/jpeg" }
→
{
  "upload_url": "http://minio:9000/lostandfound/items/a1b2c3.jpg?X-Amz-...",
  "object_key": "items/a1b2c3.jpg",
  "expires_in": 600
}
```
- Server validates `content_type` is in `["image/jpeg", "image/png", "image/webp"]`.
- Server validates `kind` in `["item", "avatar"]`. Chooses prefix: `items/` or `avatars/`.
- Object key: `<prefix><uuid4>.<ext>`.
- Presigned URL TTL: 10 minutes for PUT.

### Browser upload
```
PUT <upload_url>
Content-Type: image/jpeg
<binary>
```

### Saving the reference
- Frontend sends `object_key` to the backend (e.g. `POST /api/items/ { ..., image: "items/a1b2c3.jpg" }`).
- Backend stores the key verbatim.

### Serving
- On any serialization of an item/profile with a non-null key, backend calls `boto3` `generate_presigned_url('get_object', ...)` with 1-hour expiry and returns that URL as the `image`/`avatar` field.

### MinIO CORS
- `createbucket` step updated to set bucket CORS to allow `PUT, GET` from `CORS_ALLOWED_ORIGINS`, headers `*`.
- Remove the `mc anonymous set download` step (bucket stays private).

## 8. Security Considerations

- Presigned PUT URLs are scoped to a single object key + method + content-type + short TTL. A leaked URL can only overwrite that one object within 10 min.
- Presigned GET URLs are time-limited (1h) and unguessable. Feed refetch re-issues them.
- Uploaded content-type is validated on presign, but client can lie at upload time. Acceptable for v1 (campus audience); in v1.1 we'd do server-side type/size validation via a completion webhook.
- `is_staff` gating is enforced server-side on every admin endpoint (not frontend-only).
- Telegram reveal is scoped to the two parties of an approved claim; other users viewing the item don't see telegram.

## 9. Migration / Rollout

Single atomic rollout (not phased):
1. **Backend** — new migrations (item status choices, claim constraint, notifications app); new endpoints; modified serializers.
2. **Data migration** — `UPDATE items_item SET status='OPEN' WHERE status='CLAIMED'`. Existing `image` values were URLs; strip host prefix down to the object key pattern or (pragmatic) leave them and log — campus dataset is small, we'll fix by hand.
3. **Storage** — update `createbucket` compose step; add CORS; flip bucket private.
4. **Frontend** — rebuild with all new components, new services, redesigned header.
5. **Deploy together** via `docker compose up --build`.

## 10. Risks & Accepted Limitations

- **Legacy image URLs** (items created before this release store absolute URLs, not keys). Handled pragmatically by serializer: full URLs pass through unchanged. Accepted: old images remain publicly-reachable via the old URL even after the bucket is flipped private — they were public when stored, we're not rewriting history.
- **MinIO CORS in dev** sometimes needs a restart for the policy to take effect. Document the `mc admin service restart` step in README.
- **30s polling load**: for our user count (small), acceptable. If abuse appears, add a `Retry-After` header in a follow-up.
- **Presigned GET on every list response**: N extra `boto3` calls per list. MinIO is local — cost is negligible. For real S3, add a lightweight cache in v1.1.
- **Upload size not enforced**: presigned PUT cannot constrain `Content-Length` (boto3 POST-policy would, but we use PUT for simplicity). Accepted risk for v1; server-side completion webhook / size check deferred to v1.1.
- **Presigned URLs in referer/history**: 1h expiry mitigates; campus audience is trusted. Accepted.
- **Polling and token refresh**: the existing `authInterceptor` (`frontend/src/app/interceptors/auth.interceptor.ts`) already handles 401 → refresh → retry, so the notification poller inherits that behavior for free. No extra logic needed in `NotificationService`.

## 11. Out-of-Scope Confirmation

Not doing in v1: tests, Swagger, password reset, email verification, rate limiting, `ALLOWED_HOSTS` tightening, `on_delete` cleanup for categories. Tracked for a follow-up hardening pass.
