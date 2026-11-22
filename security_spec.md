# ORBIT Firestore Security Specification (Phase 0 & Red-Team Audit)

## Invariants
1. **Master Gate**: Every undefined path (`/{document=**}`) denies all reads and writes.
2. **Identity & Verification**: All writes require authenticated users (`request.auth != null`) with `request.auth.token.email_verified == true`.
3. **PII Isolation**: `/users/{userId}` and its subcollections (`preferences`, `readCursors`) are strictly accessible only to `request.auth.uid == userId`. No cross-user listing or reading is allowed.
4. **Path Hardening**: Single-document operations enforce `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
5. **Immutable Ownership & Timestamps**: `uid` and `createdAt` cannot be modified on update; `updatedAt == request.time` is required on mutations.
6. **Strict Schema Enforcement**: Every write checks `hasAll` + `hasOnly` + exact data types and length bounds matching `firebase-blueprint.json`.

## Dirty Payloads Verification Matrix
1. Unauthenticated read on `/users/{userId}` -> DENIED (`isOwner(userId)` fails)
2. Cross-user `get` or `list` on `/users/otherUid/readCursors` -> DENIED (`isOwner` fails; `list` on `/users` permanently `false`)
3. Unverified email user creating `/users/{uid}` -> DENIED (`email_verified == true` required)
4. Spoofed `uid` field inside `/users/{uid}` -> DENIED (`data.uid == request.auth.uid`)
5. Extra unexpected property (`role: "admin"`) on create -> DENIED (`keys().hasOnly(...)`)
6. Oversized `displayName` (> 40 chars) or `customStatus` (> 80 chars) -> DENIED
7. Client-forged `updatedAt` or `createdAt` not matching `request.time` -> DENIED
8. Modifying `createdAt` or `uid` on profile update -> DENIED
9. Modifying `targetType` or `targetId` on existing `readCursors` doc -> DENIED
10. Arbitrary path write (`/admin/config`) -> DENIED (catch-all rule)
11. Invalid `preferredStatus` or `nitroTier` enum value -> DENIED
12. Unauthenticated write to `/test/connection` -> DENIED (`allow create, update, delete: if false`)
