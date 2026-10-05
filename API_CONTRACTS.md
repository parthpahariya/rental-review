# Rental Review — API Contracts

Proposed REST/JSON contracts based on [REQUIREMENTS.md](REQUIREMENTS.md) and [DATABASE_MODEL.md](DATABASE_MODEL.md). These contracts describe observable behavior for implementation; no API server exists yet. Product decisions still open in those documents remain open here.

## Shared conventions

- Base path: `/api/v1`. All paths below are relative to it.
- Use HTTPS. Requests and responses use `application/json`, except multipart file uploads and file downloads.
- JSON field names use `snake_case`. IDs are UUID strings; timestamps are RFC 3339 UTC strings, such as `2026-10-06T12:00:00Z`; dates are `YYYY-MM-DD`.
- Required fields cannot be null. Optional request fields may be omitted; null is accepted only where explicitly stated. Reject unknown body fields with `422 VALIDATION_ERROR`, including attempts to set author IDs, roles, timestamps, or deletion state.
- Nonblank strings must contain a non-whitespace character. Validate phone numbers before normalizing to E.164. Ratings must be integers from 1 through 5.
- Single-resource success bodies use `{ "data": <resource> }`. Lists use `{ "data": [<resource>], "page": { "next_cursor": <string|null> } }`. `204` responses have no body.
- List endpoints accept optional `limit` (integer, proposed default `20`, range `1–100`) and `cursor` (opaque string). An invalid cursor or one reused with different filters produces `400 INVALID_CURSOR`.
- Reviews, interactions, and deletion requests sort by `(submitted_at DESC, id DESC)`; other collections sort by `id ASC`. Cursors preserve these orderings. An empty collection returns `200`, an empty array, and a null cursor. Pagination is not a frozen snapshot; visibility and authorization are checked on every page.
- Responses include `X-Request-ID`. Authentication and private responses use `Cache-Control: no-store`. Public review and map responses must reflect approved deletions on subsequent retrieval; initially use `no-store` as well.
- Creation returns `201` and a `Location` header when a retrievable resource is created; asynchronous file ingestion returns `202`. Specific authentication results are defined below.
- No general POST replay guarantee is assumed. Do not automatically retry review or interaction creation after an ambiguous network failure; reconcile through the author's record lists first. Authentication and decision endpoints have their own single-use/conflict rules.

### Authentication and authorization

Proposed transport: `Authorization: Bearer <opaque_session_token>`. Persist only the token digest on the server. Session tokens and OTP continuation tokens are separate credential types; a continuation token cannot access authenticated endpoints. Browser credential storage/transport must be finalized when the application stack is chosen.

| Access label | Requirement |
| --- | --- |
| Public | No session required; the response never varies to reveal private author information |
| Active user | Valid, unexpired, unrevoked session belonging to an active account |
| Author | Active user who authored the target review or interaction |
| Uploader | Active user who uploaded the target file |
| Admin | Active user with server-assigned `admin` role |
| Continuation | Valid, unexpired, unused OTP continuation token for the stated action |

Protected endpoints return `401 UNAUTHENTICATED` for missing, expired, or revoked sessions. An otherwise valid session whose account is inactive returns `403 ACCOUNT_INACTIVE`; normal deactivation revokes sessions and therefore normally yields `401`. Insufficient permissions on a public resource return `403 FORBIDDEN`. Private resources return `404 NOT_FOUND` to callers outside their authorized scope. Admin routes return `403` to authenticated non-admin users before resource lookup.

### Error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Rating must be an integer between 1 and 5.",
    "fields": [
      { "field": "rating", "code": "OUT_OF_RANGE", "message": "Use a value from 1 to 5." }
    ],
    "request_id": "req_example"
  }
}
```

`code`, `message`, `fields`, and `request_id` are always present; `fields` is empty when the error is not field-specific. Clients branch on stable codes, not message wording. `429` errors also include `error.retry_after_seconds` and the matching `Retry-After` header. Delivery errors may include `retry_after_seconds` to identify the next allowed retry.

| HTTP status | Common codes |
| --- | --- |
| `400` | `MALFORMED_REQUEST`, `INVALID_CURSOR`, `INVALID_BOUNDS` |
| `401` | `UNAUTHENTICATED`, `OTP_INVALID`, `COMPLETION_TOKEN_INVALID`, `COMPLETION_TOKEN_EXPIRED` |
| `403` | `FORBIDDEN`, `ACCOUNT_INACTIVE`, `EDIT_WINDOW_CLOSED` |
| `404` | `NOT_FOUND` |
| `405` | `METHOD_NOT_ALLOWED` (include the route's `Allow` header) |
| `409` | `OTP_ALREADY_USED`, `OTP_REPLACED`, `COMPLETION_TOKEN_USED`, `ACCOUNT_ALREADY_EXISTS`, `AUTH_FLOW_CHANGED`, `FILE_NOT_READY`, `FILE_ALREADY_ATTACHED`, `FILE_UNAVAILABLE`, `REQUEST_ALREADY_PENDING`, `REQUEST_ALREADY_DECIDED` |
| `410` | `OTP_EXPIRED` |
| `413` | `FILE_TOO_LARGE` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` |
| `422` | `VALIDATION_ERROR`, `PROOF_REQUIRED`, `FILE_PURPOSE_MISMATCH`, `CONFIRMATION_REQUIRED` |
| `429` | `OTP_REQUEST_LIMITED`, `OTP_VERIFICATION_LIMITED`, `OTP_RESEND_COOLDOWN` |
| `503` | `SMS_DELIVERY_FAILED`, `SERVICE_UNAVAILABLE` |

Unexpected failures use `500 INTERNAL_ERROR` with no stack traces or private data. Unknown resources return `404`; known but empty collections return `200`. Common validation/authentication errors apply to every endpoint in addition to its explicitly listed errors.

## Resource schemas

Fields below are exhaustive for each response shape. All fields are present unless explicitly optional; nullable fields are returned as null when unset. Nested shape names refer to the definitions in this section.

| Shape | Fields |
| --- | --- |
| `Account` (private) | `id: UUID`, `mobile_number: string`, `mobile_verified_at: timestamp`, `role: user\|admin`, `status: active\|inactive`, `deactivated_at: timestamp\|null`, `created_at: timestamp`, `updated_at: timestamp` |
| `Session` (private) | `token: string`, `token_type: "Bearer"`, `expires_at: timestamp`; raw token returned only when issuing a session |
| `Owner` | `id: UUID`, `display_name: string` |
| `Location` | `id: UUID`, `address: string`, `building_name: string\|null`, `latitude: number`, `longitude: number` |
| `ReviewSummary` | `tenant_review_count: integer`, `interaction_review_count: integer`, `average_rating: number\|null` |
| `MapLocation` | All `Location` fields plus `summary: ReviewSummary` |
| `FlatOwner` | `id: UUID` (association ID), `owner: Owner` |
| `Flat` | `id: UUID`, `label: string`, `location: Location`, `summary: ReviewSummary` |
| `TenantReview` (public) | `id: UUID`, `flat_id: UUID`, `location_id: UUID`, `flat_owner_id: UUID`, `owner: Owner`, `rating: integer`, `feedback: string`, `submitted_at: timestamp`, `updated_at: timestamp`, `editing_deadline: timestamp` |
| `InteractionReview` (public) | `id: UUID`, `flat_id: UUID`, `location_id: UUID`, `flat_owner_id: UUID`, `owner: Owner`, `description: string`, `interaction_date: date`, `submitted_at: timestamp` |
| `OwnTenantReview` (private) | All `TenantReview` fields plus `deleted_at: timestamp\|null`, `can_edit: boolean`, `can_request_deletion: boolean` |
| `File` (private) | `id: UUID`, `purpose: tenancy_proof\|interaction_support`, `original_filename: string`, `media_type: string`, `size_bytes: integer`, `status: pending\|ready\|rejected\|deletion_pending\|deleted`, `created_at: timestamp`, `updated_at: timestamp` |
| `InteractionAttachment` (private) | `id: UUID`, `interaction_review_id: UUID`, `file: File`, `created_at: timestamp` |
| `TenancyProof` (private) | `id: UUID`, `tenant_review_id: UUID`, `file: File`, `created_at: timestamp` |
| `DeletionRequest` (private) | `id: UUID`, `tenant_review_id: UUID`, `requested_by: UUID`, `reason: string`, `status: pending\|approved\|rejected`, `submitted_at: timestamp`, `decided_at: timestamp\|null`, `decision_note: string\|null` |
| `AdminDeletionRequest` (private) | All `DeletionRequest` fields plus `decided_by: UUID\|null`, `review: TenantReview`, `review_deleted_at: timestamp\|null`; review snapshot is the current stored review, retained after deletion |

Public shapes exclude author account IDs, mobile numbers, account status, proof metadata, file metadata/URLs, and deletion-request details. Supporting-file downloads remain author-only until their visibility policy is decided. `average_rating` uses only visible tenant reviews, rounded to two decimal places; it is null when the tenant review count is zero. Counts never depend on author account status.

## OTP registration, sign-in, and reactivation

### `POST /auth/otp/challenges` — Public

Request:

```json
{ "mobile_number": "+919876543210" }
```

`201` response:

```json
{
  "data": {
    "challenge_id": "11111111-1111-4111-8111-111111111111",
    "delivery_status": "pending",
    "expires_at": "2026-10-06T12:05:00Z",
    "resend_available_at": "2026-10-06T12:01:00Z"
  }
}
```

The timestamps are illustrative, not chosen product defaults. `delivery_status` is `pending` or `sent` on success; `sent` means accepted by the SMS provider, not guaranteed receipt. `Location` points to `/api/v1/auth/otp/challenges/{challenge_id}`.

Repeat this endpoint with the same phone number to resend after the cooldown. Accepted replacement issuance atomically invalidates all preceding usable challenges for that number. Invalid requests or rate-limited requests do not invalidate existing challenges. An accepted replacement remains the replacement even if its SMS delivery later fails; prior codes do not become valid again.

No response indicates whether the account exists before successful verification. Enforce shared phone/IP request and verification limits across challenges. Errors: `422 VALIDATION_ERROR`, `429 OTP_REQUEST_LIMITED`, `429 OTP_RESEND_COOLDOWN`, `503 SMS_DELIVERY_FAILED`. Immediate SMS failure returns the common error with the earliest allowed retry delay and retains delivery failure internally; clients can request a new challenge after that delay.

### `GET /auth/otp/challenges/{challenge_id}` — Public, possession of random challenge ID

`200`: `{ "data": { "challenge_id": UUID, "delivery_status": "pending|sent|failed", "expires_at": timestamp, "resend_available_at": timestamp, "failure_code": "SMS_DELIVERY_FAILED"|null } }`.

This poll endpoint reports asynchronous delivery failure and supports retry UI. It reveals no phone number, OTP, account existence, provider reference, or raw provider error. Unknown challenges return `404`. Apply abuse limits to polling; throttling returns `429 OTP_REQUEST_LIMITED`.

### `POST /auth/otp/verifications` — Public

Request: `{ "challenge_id": UUID, "code": string }`. Keep the code as a string so leading zeroes survive. Its format follows configured OTP policy.

`200` returns exactly one of these `data` variants:

| `outcome` | Additional fields | Behavior |
| --- | --- | --- |
| `signed_in` | `account: Account`, `session: Session` | Active registered user signs in to the existing account |
| `registration_required` | `completion_token: string`, `completion_expires_at: timestamp` | New number must complete registration |
| `reactivation_required` | `completion_token: string`, `completion_expires_at: timestamp` | Existing inactive account requires explicit reactivation; no session is issued yet |

Consume a successful OTP atomically. A continuation token is bound to the verified number and the returned action, short-lived, and single-use. Wrong codes increment attempts atomically. Errors: `401 OTP_INVALID`, `410 OTP_EXPIRED`, `409 OTP_ALREADY_USED`, `409 OTP_REPLACED`, `429 OTP_VERIFICATION_LIMITED`. An unknown challenge returns `401 OTP_INVALID`. None of these failures issues a session or creates an account.

### `POST /auth/registrations` — Continuation for registration

Request: `{ "completion_token": string }`.

`201`: `{ "data": { "account": Account, "session": Session } }`; `Location: /api/v1/me`.

Create the account only after valid phone verification, using the verified number from the continuation token, and consume the token atomically with account/session creation. Client-supplied mobile number, role, or status is not accepted. No additional registration fields are defined until the requirements resolve them; this is a provisional phone-only registration contract.

Errors: `401 COMPLETION_TOKEN_INVALID`, `401 COMPLETION_TOKEN_EXPIRED`, `409 COMPLETION_TOKEN_USED`. If a concurrent registration already created that number, return `409 ACCOUNT_ALREADY_EXISTS` and require a fresh OTP sign-in; never create a duplicate account or issue a session through the conflicting registration.

### `POST /auth/reactivations` — Continuation for reactivation

Request: `{ "completion_token": string, "confirm": true }`.

`200`: `{ "data": { "account": Account, "session": Session } }`.

Restore the same inactive account and create a new session atomically with token consumption. Previously revoked sessions remain revoked. Original review submission times and editing deadlines remain unchanged. Errors: continuation-token errors above, `422 CONFIRMATION_REQUIRED`, and `409 AUTH_FLOW_CHANGED` if another operation already reactivated the account; obtain a new OTP to sign in.

### `DELETE /auth/session` — Active user

No request body. Revoke the presented session; return `204`. Other sessions remain valid. Reusing the revoked session returns `401`.

## Account management

### `GET /me` — Active user

`200`: `{ "data": Account }`. Account information is available only to its holder.

### `GET /me/deactivation-preview` — Active user

`200`:

```json
{
  "data": {
    "confirmation_required": true,
    "sessions_will_end": true,
    "tenant_reviews_remain_visible": true,
    "interaction_reviews_remain_visible": true,
    "message": "Deactivating ends your sessions. Your existing tenant reviews and interaction reviews remain visible."
  }
}
```

The UI must explain these effects before requesting confirmation.

### `POST /me/deactivation` — Active user

Request: `{ "confirm": true }`. `200`: `{ "data": { "status": "inactive", "deactivated_at": timestamp } }`.

Atomically mark the account inactive and revoke every session. No review, interaction, rating, or attachment is hidden by this operation. Missing or false confirmation returns `422 CONFIRMATION_REQUIRED`. Subsequent use of old sessions returns `401`.

## Public configuration and property discovery

### `GET /review-submission-policy` — Public

`200`: `{ "data": { "proof_policy_id": UUID, "proof_required": boolean, "effective_from": timestamp, "editing_window_days": 30 } }`.

The initial policy has `proof_required: false`. The server selects the policy effective at submission; the client cannot pin an older policy. A stale form may therefore receive `422 PROOF_REQUIRED` and should refresh this endpoint. Policy administration is deployment configuration, not a public mutation endpoint.

### Discovery endpoints — Public

| Endpoint | Query parameters beyond pagination | `200` result |
| --- | --- | --- |
| `GET /locations` | Optional `bbox=west,south,east,north`; optional `reviewed_only=true|false`, default `true`; optional nonblank `q` | List of `MapLocation` |
| `GET /locations/{location_id}` | None | Single `MapLocation`, even if it currently has no reviews |
| `GET /locations/{location_id}/flats` | None | List of `Flat`, including flats without feedback |
| `GET /flats/{flat_id}` | None | Single `Flat` |
| `GET /flats/{flat_id}/owners` | None | List of `FlatOwner`, including associations without feedback |
| `GET /owners` | Optional nonblank `q` | List of `Owner` |
| `GET /owners/{owner_id}` | None | Single `Owner` |
| `GET /owners/{owner_id}/flats` | None | List of `{ "flat_owner_id": UUID, "flat": Flat }` |

`bbox` uses inclusive WGS84 longitude/latitude bounds. Longitude must be within `[-180, 180]`, latitude within `[-90, 90]`, and south must not exceed north. A west value greater than east denotes an antimeridian-crossing viewport. Invalid bounds return `400 INVALID_BOUNDS`. No bounds means all locations, paginated. `q` performs case-insensitive substring matching on location address/building name or owner display name respectively; combine it with other filters using AND.

With `reviewed_only=true`, include a location when any of its flats has at least one visible tenant review **or** interaction review. Do not require tenant reviews for a marker. Counts and average ratings are scoped to the returned location or flat, across its owner associations. A location with several flats leads to flat selection; both feedback tabs use the chosen flat ID. Clients must follow `next_cursor` to obtain all matching markers. The same location results support the accessible text list.

Use `reviewed_only=false` to find existing locations for a first review. Unknown parent IDs in nested collection endpoints return `404`. Creating or merging locations, flats, owners, and associations is deferred until the record creation and deduplication workflow is decided; these endpoints select already provisioned records.

## Tenant reviews

### `GET /flats/{flat_id}/tenant-reviews` — Public

Paginated list of `TenantReview`. Optional `owner_id: UUID` narrows results within that flat. A well-formed owner filter with no matching association returns an empty list.

### `GET /owners/{owner_id}/tenant-reviews` — Public

Paginated list of `TenantReview` across that owner’s flats. Optional `flat_id: UUID` narrows results. Only visible reviews contribute; all results retain their specific flat/location IDs.

### `GET /tenant-reviews/{review_id}` — Public

`200`: `{ "data": TenantReview }`. Unknown or admin-deleted reviews return `404`. Inactive authors' reviews remain accessible.

### `POST /flats/{flat_id}/tenant-reviews` — Active user

Request:

```json
{
  "flat_owner_id": "22222222-2222-4222-8222-222222222222",
  "rating": 4,
  "feedback": "Maintenance requests were handled promptly.",
  "proof_file_ids": []
}
```

`flat_owner_id`, `rating`, and nonblank `feedback` are required. `proof_file_ids` is optional and defaults to an empty array of unique UUIDs. The association must belong to the path's flat; an invalid or mismatched association returns `422 VALIDATION_ERROR`.

`201`: `{ "data": TenantReview }`; `Location: /api/v1/tenant-reviews/{review_id}`.

Derive the author from the session. Publish immediately. Select and persist the effective proof policy, validate ready proof files owned by the author, and create the review and proof links in one transaction. A mandatory policy requires at least one valid proof; otherwise return `422 PROOF_REQUIRED` with no review created. Other errors: `404 NOT_FOUND` for unavailable private file IDs, `409 FILE_NOT_READY`, `409 FILE_ALREADY_ATTACHED`, `422 FILE_PURPOSE_MISMATCH`. Do not impose a one-review-per-author limit.

### `PATCH /tenant-reviews/{review_id}` — Author

Request: one or both of `{ "rating": integer, "feedback": nonblank_string }`; an empty object is invalid.

`200`: `{ "data": TenantReview }`. Only these two fields may change. Preserve the original submission instant and derive `editing_deadline = submitted_at + 30 elapsed days`. The server must check `now < editing_deadline` within the write; exactly at the deadline editing is closed. Errors: `403 FORBIDDEN` for another author, `403 EDIT_WINDOW_CLOSED`, `404 NOT_FOUND` for deleted/unknown reviews. Reactivation or earlier edits do not extend the deadline.

### Private author retrieval

| Endpoint | `200` result |
| --- | --- |
| `GET /me/tenant-reviews` | Paginated list of `OwnTenantReview`; includes the author's logically deleted reviews for history |
| `GET /me/tenant-reviews/{review_id}` | Single `OwnTenantReview`; another author's review returns `404` |
| `GET /me/tenant-reviews/{review_id}/proofs` | Paginated list of `TenancyProof`; another author's review returns `404` |

All require an active user. `can_edit` is true only for a visible review before its deadline. `can_request_deletion` is true only for a visible review without a pending request. These flags assist the UI; the server still checks conditions during each mutation. Proof attachment changes after submission are not defined by the current requirements.

`DELETE /tenant-reviews/{review_id}` returns `405 METHOD_NOT_ALLOWED` with `Allow: GET, PATCH`. Authors must use the deletion-request process below; admins also approve requests through that process rather than directly deleting reviews.

## Interaction reviews and supporting attachments

### Public retrieval

| Endpoint | Optional filters beyond pagination | `200` result |
| --- | --- | --- |
| `GET /flats/{flat_id}/interactions` | `owner_id: UUID` | List of `InteractionReview` |
| `GET /owners/{owner_id}/interactions` | `flat_id: UUID` | List of `InteractionReview` |
| `GET /interactions/{interaction_id}` | None | Single `InteractionReview` |

Unknown parent or detail resources return `404`; a filter with no matches returns an empty list. Public access is independent of the author's account status and requires no tenant review. Attachment metadata is excluded from public interaction responses pending a supporting-file visibility decision.

### `POST /flats/{flat_id}/interactions` — Active user

Request:

```json
{
  "flat_owner_id": "22222222-2222-4222-8222-222222222222",
  "description": "Viewed the flat and discussed the deposit.",
  "interaction_date": "2026-10-05",
  "supporting_file_ids": []
}
```

The association, nonblank description, and valid calendar date are required. `supporting_file_ids` is optional, defaulting to an empty array of unique UUIDs. Validate that the association belongs to the path's flat and any files are ready, unassociated, author-owned `interaction_support` files. No future-date prohibition is assumed by the requirements.

`201`: `{ "data": InteractionReview }`; `Location: /api/v1/interactions/{interaction_id}`. Publish immediately and create requested attachment links in the same transaction. Do not require tenancy proof, a rating, or a tenant review. Invalid attachments fail the entire submission. Errors match tenant-review file validation above, without `PROOF_REQUIRED`.

### Private interaction retrieval — Active user

| Endpoint | `200` result |
| --- | --- |
| `GET /me/interactions` | Paginated list of the caller's `InteractionReview` records |
| `GET /me/interactions/{interaction_id}` | Single caller-owned `InteractionReview`; other authors' IDs return `404` |

### `GET /interactions/{interaction_id}/attachments` — Author

`200`: paginated list of `InteractionAttachment` with removed attachments excluded. Other users receive `404` for this private collection.

### `POST /interactions/{interaction_id}/attachments` — Author

Request: `{ "file_id": UUID }`. `201`: `{ "data": InteractionAttachment }`; `Location: /api/v1/interactions/{interaction_id}/attachments/{attachment_id}`.

The file must be a ready, unassociated, author-owned `interaction_support` file. Adding files is allowed at posting time or anytime afterward; there is no 30-day deadline for supporting attachments. Errors: `403 FORBIDDEN` for a different interaction author, `404 NOT_FOUND` for a file outside the caller's scope, `409 FILE_NOT_READY`, `409 FILE_ALREADY_ATTACHED`, `422 FILE_PURPOSE_MISMATCH`.

### `GET /interactions/{interaction_id}/attachments/{attachment_id}` — Author

`200`: `{ "data": InteractionAttachment }`. Unknown, removed, mismatched, or unauthorized attachment IDs return `404`.

### `DELETE /interactions/{interaction_id}/attachments/{attachment_id}` — Author

No body. Return `204` after logically removing the attachment and scheduling object deletion. The interaction remains unchanged. Repeating removal of the same attachment by its author returns `204`; unknown, mismatched, or unauthorized IDs return `404`. Removed file content becomes immediately unavailable through the API, even if physical deletion is pending.

`PATCH` and `DELETE /interactions/{interaction_id}` return `405 METHOD_NOT_ALLOWED` with `Allow: GET`. Editing/deleting interaction text and linking interactions to tenant reviews remain unresolved product decisions.

## Private file lifecycle

### `GET /file-upload-policy` — Active user

`200`: `{ "data": { "purposes": [ { "purpose": "tenancy_proof", "allowed_media_types": [string], "max_size_bytes": integer }, { "purpose": "interaction_support", "allowed_media_types": [string], "max_size_bytes": integer } ] } }`.

Returns deployment-selected types and limits; no numeric limits or allowed types are fixed by the current requirements. Server enforcement is authoritative if policy changes after fetching.

### `POST /files` — Active user

Content type: `multipart/form-data`. Required parts: `purpose` (`tenancy_proof` or `interaction_support`) and `file` (one binary file with its filename and media type). Reject additional parts and multiple files in one request.

`202`: `{ "data": File }` with status `pending`; `Location: /api/v1/files/{file_id}`. Upload ingestion and file validation complete before a file becomes `ready`; clients poll the file endpoint. The original filename and claimed media type are untrusted input. Errors: `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `422 VALIDATION_ERROR`, `503 SERVICE_UNAVAILABLE`.

An upload is not itself a proof or interaction attachment. Associate its ID only after status becomes `ready`. Rejecting or failing an upload never publishes a review. Expired unattached uploads are cleaned up by configured retention policy.

### `GET /files/{file_id}` — Uploader

`200`: `{ "data": File }`. Status transitions are `pending → ready|rejected` and, when cleanup/removal applies, `pending|ready|rejected → deletion_pending → deleted`. Terminal/rejected files cannot be attached. Unknown files or another uploader's files return `404`.

### `GET /files/{file_id}/content` — Uploader

Return `200` with binary content, validated `Content-Type`, sanitized `Content-Disposition: attachment`, and `Cache-Control: no-store`. The API streams bytes after checking current access; it does not return a permanent URL or storage key. Only ready, accessible files can be downloaded. Pending/rejected files return `409 FILE_NOT_READY`; removed or deleted files return `404`, including while object cleanup is pending.

Proof content stays private. No general file-delete endpoint is provided: supporting files are removed through their interaction attachment, and unused uploads are cleaned up automatically. Administrative access to proof files is outside the present requirements.

## Review deletion requests and admin decisions

### `POST /tenant-reviews/{review_id}/deletion-requests` — Author

Request: `{ "reason": nonblank_string }`.

`201`: `{ "data": DeletionRequest }` with status `pending`; `Location: /api/v1/me/deletion-requests/{request_id}`.

The review remains public, including its rating. Requests are allowed before or after the edit deadline. Proposed policy from the database model: at most one pending request per review; rejection permits a later new request. Errors: `403 FORBIDDEN`, `404 NOT_FOUND` for deleted/unknown reviews, `409 REQUEST_ALREADY_PENDING`. A pending request does not stop otherwise permitted review edits.

### Author request status — Active user

| Endpoint | Query | `200` result |
| --- | --- | --- |
| `GET /me/deletion-requests` | Optional `status=pending|approved|rejected`, plus pagination | List of caller's `DeletionRequest` records |
| `GET /me/deletion-requests/{request_id}` | None | Single caller-owned `DeletionRequest`; unauthorized/unknown IDs return `404` |

Requests remain retrievable after approval and after account reactivation. Inactive users must reactivate to access authenticated account features.

### Admin review queue — Admin

| Endpoint | Query | `200` result |
| --- | --- | --- |
| `GET /admin/deletion-requests` | `status=pending|approved|rejected|all`, default `pending`, plus pagination | List of `AdminDeletionRequest` |
| `GET /admin/deletion-requests/{request_id}` | None | Single `AdminDeletionRequest` |

The admin response includes the review needed to assess the request without exposing the author's phone number or proof files. Existing pending requests can be decided even if their author has since deactivated.

### `POST /admin/deletion-requests/{request_id}/decision` — Admin

Request:

```json
{ "decision": "approved", "decision_note": "Deletion request accepted." }
```

`decision` is required and must be `approved` or `rejected`. `decision_note` is optional, nullable, and nonblank when supplied as a string; it is visible to the requesting author.

`200`: `{ "data": AdminDeletionRequest }`. Record the admin and decision timestamp from server context. Approval atomically marks the request approved and logically deletes the tenant review. Rejection changes only the request. Once approved, subsequent public detail reads return `404`, lists and rating aggregates exclude the review, and a location marker disappears only if no visible tenant reviews or interactions remain there.

Decisions are final. Repeated or competing decisions return `409 REQUEST_ALREADY_DECIDED`; clients can retrieve the request to reconcile a lost response. Unknown requests return `404`. There is no requirement for the requester to remain active while an admin considers their request.

## Required behavior checks

These scenarios define acceptance expectations for a future implementation; they are not claims of completed runtime tests.

| Scenario | Expected result |
| --- | --- |
| Existing active phone completes OTP | Existing account and new session; no duplicate account |
| Replacement code requested | Prior usable OTP invalidated; shared request/verification limits persist |
| OTP reused or verification races | At most one success; subsequent use fails clearly |
| Inactive phone completes OTP | Reactivation continuation; no session until confirmation |
| Account deactivated with multiple sessions | All sessions revoked; public reviews and interactions unchanged |
| Optional/mandatory proof | Empty proof array succeeds under optional policy and fails atomically under mandatory policy |
| Review edited at exactly 30 days | `403 EDIT_WINDOW_CLOSED`; earlier edits/reactivation never shift deadline |
| Wrong author attempts mutation | Forbidden or private-resource `404`; no record or file changed |
| Location has only interactions | Included in map and text results |
| Several flats/owners share a location | Each record retains flat and owner identity; tab filters do not mix flats |
| Supporting attachment removed | File unavailable immediately; interaction text remains public |
| Deletion request pending/rejected | Review and rating stay public |
| Deletion approved | Review/rating removed from public detail, lists, map counts, and aggregates atomically |
| Anonymous public reads | Never return mobile numbers, proofs, author account data, or private attachment metadata |

## Coverage and deferred decisions

| Requirement | Contract area |
| --- | --- |
| FR-01 | OTP issuance/status/verification, registration, sessions |
| FR-02 | Deactivation preview/action, OTP reactivation, preserved public visibility |
| FR-04 | Tenant review submission/retrieval/editing, proof policy and private files |
| FR-05 | Location viewport/text search, owner/flat navigation, both feedback collections |
| FR-06 | Public interactions, private uploads and author attachment management |
| FR-07 | Separate flat-scoped tenant-review and interaction endpoints |
| FR-08 | Author deletion requests/status and admin queue/decisions |

Before implementation, resolve extra registration fields; SMS provider, supported countries, expiry/cooldown/limits; owner/property provisioning and deduplication; interaction editing/deletion/linking; arbitrary-point nearby search and radius; map provider/coverage; file limits and supporting-file visibility; data retention; and final browser session transport. Generic pagination defaults, transport, substring search, and error conventions above are proposed API choices, not previously approved product decisions. No public property-creation workflow, proof-review workflow, or interaction-deletion approval process is implied.
