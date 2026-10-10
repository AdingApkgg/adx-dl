# Community Storage and Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver resumable authenticated file storage and explicitly saved public avatars, including revocation, cleanup, deletion and a verified original-file backup/restore path.

**Architecture:** PostgreSQL owns leases, quotas, object generations, business permissions and durable outboxes. Internal authenticated SeaweedFS stores immutable original/derived objects; a separate bounded media worker runs the pg-boss ingest → avatar → finalize flow. The existing Hono API and profile UI expose the first business purpose, while the existing control worker handles revocation and cleanup.

**Tech Stack:** Bun 1.4.2, TypeScript, React Router 8, Hono, Drizzle/PostgreSQL 18, pg-boss 12.35.0, TanStack Query, Paraglide, @aws-sdk/client-s3 3.1149.0, sharp 0.35.5, @noble/hashes 2.4.0, SeaweedFS 4.48, restic. Exact package pins were checked against official npm metadata; native/API behavior remains subject to runtime tests.

**Spec:** `docs/superpowers/specs/2026-10-10-community-storage-design.md` (full design approved by the user on 2026-10-10).

## Global Constraints

- Work only in `/Users/i/.codex/worktrees/community-storage-design/AstroDX`, branch `codex/community-storage-design`, base `1e07466818604fde7171bc8460772fe51e9683bf`; preserve the main checkout's unrelated edits. Commit locally; no public push or Dash draft submission.
- Only `avatar` is an enabled business purpose. No chart module, Google/QQ avatar import, remote URL fetching, signature creation, image crop editor or monitoring platform.
- Input 1–8,388,608 bytes; JPEG/PNG/WebP/AVIF, no animation; 16,000,000 pixels and 8192 per side. Recipe `avatar-v1`: orientation, sRGB, center-cover 512×512, white flatten, JPEG quality 85, non-progressive, no metadata, output ≤524,288 bytes.
- Parts 4,194,304 bytes; generic ceiling 480,000,000 bytes / 115 parts; individual logical quota 33,554,432 bytes including reservations; two active uploads per user / 100 globally; absolute 24h TTL.
- Initialization 10/user/hour and 60/IP/hour; parts 120/user/minute and two concurrent/user; retain generic IP 300/minute and other writes 60/user/minute. HTTP part admission encloses bounded body reading and the whole PUT/settlement: two per user and eight globally, immediate503 on saturation, no unbounded waiting or pre-admission body buffering.
- Temporary budget 2 GiB, original budget 20 GiB, derived budget 2 GiB; stop new uploads below 5 GiB free disk. Read concurrency 32 / PUT 8, reject saturation 503 without an unbounded queue. A 30s window with five consecutive real storage failures opens the breaker 15s, with one half-open probe.
- Media ingest concurrency 1 and sharp concurrency 1; disk-backed temporary volume ≤2 GiB; child processing wall clock 30s and task 120s. Single web instance is required for drain acknowledgements.
- Original bytes remain private; only processed avatar bytes become public. `/media/<lowercase output SHA256>.jpg` GET/HEAD accepts no query, never uses cookies/session, never sets cookies or user-dependent variants. Error/private responses are `private, no-store`.
- Public GET uses true MIME, byte-hash ETag, one byte range, nosniff, sandbox CSP, same-origin CORP and `public, max-age=31536000, immutable`. Permission/status/block checks precede 304/206. Storage outages are 503, not deletion 404.
- Revocation is durable and bounded: current-generation origin drain ACK; two canonical URL purges ≥5s apart; two anonymous canonical URL 404 probes ≥5s apart, neither HIT; final locked recheck. Each request ≤10s, one attempt ≤60s; errors stay revoking. Never promise removal of existing browser copies.
- Temporary terminal objects 1h; unknown tmp 48h; unattached/old files 24h; minimum file tombstones 30 days; independent original/derived orphan grace 7 days. Shared output is one physical object and one budget charge.
- No S3/Cloudflare calls while holding business row-lock transactions. Every storage mutation participates in the shared maintenance advisory lock, and external writes use leases/generation CAS.
- Use one lock order for multi-row mutations: storage advisory lock → maintenance admission row FOR SHARE → existing user row (if applicable) → own usage → global budget → sessions/parts/attempts → logical files/avatars → original objects → recipe relations → derived objects → publications/outboxes. Sort multiple IDs/hashes within a class. Background GC takes no user-row locks and acquires the global budget before object claims; its reference checks are reads under this coordination lock. The global budget lock is held only for short DB state changes, never external IO. Existing-lease completions may need a distinct drain-safe maintenance path in Task10; new work remains closed.
- Extend the existing 03:30 backup: only original objects plus both PG dumps and full manifest; `community-full`, 7 daily/4 weekly/6 monthly. Maintenance ≤5min, backup ≤30min, deletion journal outside snapshots ≤1min export lag and seven months retention; restore fails closed on a journal gap. No offsite-backup claim.
- Credentials remain env/0600 mounted configuration, absent from Git/logs/browser. Cloudflare purge token only in the control worker, no S3 host port/tunnel, `NO_PROXY` includes SeaweedFS. Preserve NapCat reuse and existing deploy overlay.
- Runtime/library/image choices must be pinned and tested against their actual APIs. Use meaningful real-PG/S3 tests, not source-text assertions as substitutes for behavior. Tests must use isolated `_test` databases and non-production volumes.

## Review Focus

1. A tab retries after a lost success response: upload/part/complete/avatar mutation replays must converge without double quota, duplicate flow or accidental revision increment (Tasks 3, 4, 6).
2. A cancelled upload or account deletion races an in-flight PUT/sharp child: late work cannot publish an avatar or retain reservations forever (Tasks 3, 5, 8).
3. Two distinct originals produce identical JPEG bytes: one source's retirement/GC must preserve the other user's public avatar and charge physical bytes once (Tasks 5, 8).
4. Revocation races an origin response/CDN cache fill or a stale generation: register before permission lookup, drain first, keep revoking on any failed evidence; never overwrite a newer publication (Tasks 6, 7).
5. Restore uses a snapshot predating an account deletion: latest encrypted tombstones must prevent resurrection; missing/gapped journals keep public media closed (Task 10).

---

## File and interface map

All paths below are under `apps/community/` unless named otherwise. Keep new files focused; their companion tests sit beside them, real-S3 tests in `test/storage/`, browser DOM tests in `test/dom/` and deployment tests in `test/ops/`.

| File/module | Responsibility |
|---|---|
| `src/shared/storage.ts` | Serializable upload/file/avatar DTOs and stable public error codes |
| `src/server/db/schema/storage.ts`, migration `0004_storage.sql` + metadata | Relational storage/physical object/business/outbox/maintenance/tombstone ledger constraints |
| `src/server/storage/{rules,errors,keys,transactions,contracts}.ts` | Purpose limits, safe names/keys, typed failures, maintenance locking, driver/runtime interfaces |
| `src/server/storage/{env,s3,gate,runtime}.ts` | Role config, bounded cancellable object IO and breaker/readiness; no business permissions |
| `src/server/storage/{uploads,parts,usage,flow}.ts`, `src/server/api/uploads.ts` | PG reservations, upload/part state machine, flow submission and HTTP validation |
| `src/media-worker/{main,ingest,avatar,finalize,image-child}.ts`, `src/server/storage/objects.ts` | Restartable original/derived leases and bounded image processing |
| `src/server/storage/{avatars,references,files,range,public-media,drain}.ts`, `src/server/api/{files,avatar}.ts` | Typed avatar association, authorization, streaming, idempotency and internal drain/resume |
| `src/worker/{media-purge,storage-sweep,storage-delete,storage-journal}.ts` | Durable revocation, GC/dead-letter repair, physical deletion and tombstone export |
| `src/server/storage/{deletion,maintenance,backup}.ts` | Account prepare/restore/purge hooks, backup write barrier, manifest/export and recovery primitives |
| `src/client/{workers/file-hash,lib/file-upload,components/avatar-upload,queries/storage}.ts[x]` | Streaming hash, resumable upload controller, profile UI and API queries |
| `ops/seaweed/*`, `ops/backup/*`, compose/Dockerfile/deploy/env/README | Role credentials, pinned storage service, worker/resource/health lifecycle and restore runbook |

The first task establishes these shared signatures, so later tasks consume the same types:

```ts
type ObjectBucket = "original" | "derived";
type ObjectHead = { size: number; mime: string; sha256: string; etag?: string };
type ObjectRead = ObjectHead & { body: ReadableStream<Uint8Array> };
type ObjectDriver = {
  put(input: { bucket: ObjectBucket; key: string; body: ReadableStream<Uint8Array>;
    size: number; mime: string; sha256: string; signal?: AbortSignal }): Promise<void>;
  get(input: { bucket: ObjectBucket; key: string; range?: { start: number; end: number };
    signal?: AbortSignal }): Promise<ObjectRead>;
  head(input: { bucket: ObjectBucket; key: string; signal?: AbortSignal }): Promise<ObjectHead | null>;
  delete(input: { bucket: ObjectBucket; key: string; signal?: AbortSignal }): Promise<void>;
  list(input: { bucket: ObjectBucket; prefix: string; cursor?: string; signal?: AbortSignal }):
    Promise<{ objects: { key: string; size: number; modifiedAt: Date }[]; cursor?: string }>;
  copy(input: { bucket: ObjectBucket; sourceKey: string; key: string; signal?: AbortSignal }): Promise<void>;
  ready(signal?: AbortSignal): Promise<void>;
};
type StorageContext = { db: Db; boss: () => Promise<PgBoss>; driver: ObjectDriver;
  config: StorageConfig; log: Logger; now?: () => Date };
type StorageJobData = { uploadId: string; generation: number };
// HTTP-facing services throw StorageError(status, code), with safe messages only.
// Driver absence is ObjectMissingError; upstream timeout/unavailable is StorageUnavailableError.
// DTO date fields are ISO strings and sizes/revisions/generations are safe integers.
```

Every commit stages explicit owned files only. Run from `apps/community` with `PATH=/Users/i/.bun/bin:$PATH`; use `bun test <paths>` for Bun tests, `bun x vitest run <paths>` for DOM, and the actual existing project scripts for broader checks. Do not run parallel reset processes against the same database.

### Task 1: Relational ledger and shared contracts

**Files:** create shared/storage.ts; server/db/schema/storage.ts; 0004 migration and its Drizzle snapshot; storage/contracts.ts, rules.ts, keys.ts, errors.ts, transactions.ts; matching tests. Modify schema/index.ts and migration journal only.

**Interfaces:** produce the map above, `AVATAR_RULE`, `normalizeOriginalName(name:string):string`, `objectKey(hash:string):string`, `StorageError`, `withStorageTransaction<T>(db:Db, fn:(tx:DbTransaction)=>Promise<T>):Promise<T>` and `lockStorageMutation(tx):Promise<void>`. Shared lock key is `714102026`; maintenance lease is checked after taking the shared xact lock.

- [ ] Write tests `storage-schema.test.ts` proving DB rejects invalid hashes/states/negative bytes, duplicate output hash, half-null avatar FK pair and negative usage; delete user preserves outboxes, sets files.ownerId null and cascades only personal rows. `rules.test.ts` asserts avatar maxSize=8388608, quota=33554432, partSize=4194304; `keys.test.ts` asserts `../a\r\nb.png` becomes a safe basename and canonical hash key is `sha256/ab/cd/<hash>`. Add migration behavior tests, not only SQL text matching.
- [ ] Run new tests and retain the failing result before implementation (missing exports/tables).
- [ ] Implement policies, blobs, files, derived_objects, blob_derivatives, user_avatars, blob_blocks, upload_sessions, upload_parts, storage_usage, storage_budget, media_publications, media_purge_requests, avatar_mutations. Add maintenance lease and append-only storage tombstones needed by Tasks 8/10. Add `upload_attempts` as the durable ledger for every attempt key/bytes/state/generation: replacing an expired part lease must not lose accounting for its old physical key. Add `user_avatars.suspendedAt` to preserve the association and pin its file during account cooling-off while withholding publication. Enforce spec CHECK/FK/indexes and initialize the one global budget row; local policy is registered from validated runtime config, no credentials in migration. Use real transactional uniqueness/lock ordering, no reference-count permission shortcut.
- [ ] Run `bun test src/server/storage/rules.test.ts src/server/storage/keys.test.ts src/server/db/storage-schema.test.ts`; PASS all assertions with fresh migrations, then verify `db:generate` produces no uncommitted schema delta.
- [ ] Commit `feat(community): add storage ledger and upload contracts` with explicit Task 1 files.

### Task 2: Authenticated bounded S3 adapter and storage configuration

**Files:** create storage/env.ts, s3.ts, gate.ts, runtime.ts, tests and `test/storage/s3.test.ts`; add direct pinned @aws-sdk/client-s3 dependency in package.json/root bun.lock. Modify env.ts/env.test.ts and test/http/server.ts only as needed for validated web role config.

**Interfaces:** consume Task 1 ObjectDriver; produce `parseStorageEnv(source,role:"web"|"media"|"control"|"backup"):StorageConfig`, `createS3Driver(config):ObjectDriver`, `createStorageContext(...)`, `createStorageGate({limit,now}):{acquire():()=>void}`, and circuit-breaker wrapper. Config uses canonical internal endpoint, us-east-1, blobs/derived, role-specific keys, budgets/temp dir/recipe build; only control config includes zoneId/purgeToken and internal media bearer. Missing role requirements reject startup; test constructors may inject fake driver without env.

- [ ] Write gate tests proving saturation 503, cancel/release reuse, five consecutive failures in 30s → 15s open, single half-open probe, missing/forbidden object failures excluded. Real S3 tests assert signed put/head/get/range/copy/delete/list, server hash metadata/size, streamed cancellation releases permits, anonymous GET/PUT rejected. Env tests assert missing required key names are reported without values, and non-control config never exposes purge token.
- [ ] Run to FAIL without implementation; initialize only isolated test storage (Task 11 later supplies permanent compose wiring).
- [ ] Implement S3 adapter with explicit endpoint/path-style, bounded acquisition, request deadlines and streaming cancellation/backpressure. Hold read permit until body ends/cancels; do not buffer a full object; use checksum settings verified against selected SeaweedFS. Readiness signs HeadBucket for both buckets. Stream errors trip breaker; S3 404 becomes ObjectMissingError, other failures 503.
- [ ] Run scoped Bun + real-S3 tests; PASS includes restart/data persistence and actual ACL behavior, recording any bucket-level rather than prefix-level ACL limitation. Run dependency lockfile validation.
- [ ] Commit `feat(community): add bounded authenticated object storage`.

### Task 3: Upload reservation and resumable part API

**Files:** create storage/usage.ts, uploads.ts, parts.ts and tests; api/uploads.ts and tests. Modify storage/transactions.ts admission locking and services/api-services.ts, api/v1.ts, app.ts and middleware/{csrf,body-limit,rate-limit}.ts and their relevant tests.

**Interfaces:** consume StorageContext. Produce `initUpload(ctx,userId,input,idempotencyKey):Promise<UploadDto>`, `getUpload(ctx,userId,id):Promise<UploadDto>`, `putUploadPart(ctx,userId,id,index,bytes,declaredHash):Promise<void>`, `cancelUpload(ctx,userId,id):Promise<void>` and `isUploadPartRequest(method,path):boolean`. Complete handler will call Task 4's `completeUpload`; until then expose no falsely accepted complete route. GET DTO contains only own received parts and ISO expiry.

- [ ] Write real-PG race tests: three concurrent init requests for one user accept exactly two, reservations ≤32MiB; same idempotency key/body returns same id, changed body409; global caps/budgets reject without rows; pending_deletion user cannot reserve. A user knowing another's private-original hash gets ordinary receiving DTO. Tests assert same part replay204, different hash409, expired lease takeover, stale PUT completion cleans own key, cancellation releases once.
- [ ] Write HTTP tests: exact PUT UUID/parts/index admits octet-stream up to4194304; no Content-Length411, nonnumeric/mismatch400, extra actual bytes413, hash mismatch rejection, wrong Origin403 even for binary, Bearer allowed; sibling/nonexact routes retain64KiB/JSON rules and genericIP limit. Assert binary parts use120/min and max2 concurrent per user without consuming the60/min write bucket.
- [ ] Run scoped tests to FAIL; implement PG row locking/reservations/idempotency, 24h absolute expiry and lease120s. Receive only bounded part buffers, hash server-side, put attempt key outside tx and CAS ready. Maintenance/free-disk gates stop init/mutations with explicit503. Admission locks the global maintenance row FOR SHARE unconditionally before server-clock lease checks and before user/budget locks; missing singleton failsclosed. Use bounded lock/statement deadlines with typed503 and no callback after admissionfailure. Task10 gate-close takes the same row FOR UPDATE, so previously admitted DBmutations commit before close and cannot create a new lease afterward; add the focused PG admission-close race test now. Hash qualification requires owner's existing undeleted ready original, not public avatar output. Normalize names and blocklist queries without existence leakage.
- [ ] Run scoped tests to PASS including part out-of-order, HEAD/GET ownership404, cancellation during actual storage PUT and maintenance rejection. Init reserves logical expectedSize only; temporary reservation belongs to each physical part attempt. Original physical reservation is Task4's unique blob/generation claim before PUT; derived reservation is Task5's unique output-hash claim using actual output size, never maxOutputSize at init. Init locks/checks current headroom conservatively; only an owner-qualified existing ready original may bypass new-original headroom, with no foreign-hash difference. No Redis quota truth and no external IO under a PG row lock.
- [ ] Commit `feat(community): add resumable authenticated upload API`.

### Task 4: Transactional flow and verified original ingestion

**Files:** create storage/flow.ts, objects.ts; media-worker/ingest.ts and tests; modify jobs/boss.ts, queues.ts, their tests, uploads.ts eligible initialization/complete and API uploads complete route. Add storage test fixtures/helpers with controlled per-test IDs.

**Interfaces:** produce `completeUpload(ctx,userId,id):Promise<UploadDto>`, `enqueueStorageFlow(boss,tx,data:StorageJobData):Promise<string[]>`, `ingestUpload(ctx,data):Promise<void>`, physical lease operations in objects.ts and `rejectUpload(ctx,data,code):Promise<void>`. Canonical writer has object generation independent of upload/recipe generations.

- [ ] Write real-PG tests: complete racing twice creates one file and one three-job dependency chain; rollback leaves neither business changes nor jobs; missing/writing part409; processing replay202 and ready replay200. Ingest fixture reads parts in order and checks per-part/full SHA256 and byte count; mismatch produces terminal rejection/released quota, temporary upstream failure retries. Two sessions with the same original produce one physical row/budget charge; stale writer cannot publish and deleting generation cannot be reused.
- [ ] Run to FAIL; implement exact pg-boss flow with custom `db:fromDrizzle(tx,sql)` and payload uploadId/generation. The actual 12.35.0 API is `flow(FlowJob[], {db}) → Record<ref,jobId>`; refs are ingest/avatar/finalize, dependencies avatar→ingest and finalize→avatar. The wrapper returns IDs in that fixed order. Singleton conflict aborts the transaction rather than returning null. Register storage dead/ingest/avatar/finalize/sweep/cleanup/delete/purge queues in dependency-safe order with options from spec §9. Do not invoke placeholder avatar/finalize workers.
- [ ] Implement disk-streamed ingest: tmp parts → bounded local file, server hashes/magic detection, original object put/head verify, PG CAS ready. Eligible instant initialization must atomically create processing file/session and the same flow once, rather than fabricate ready parts; extend Task3 init with a shared transactional completion helper. Eligible instant upload uses the same flow and validated source; ready originals still undergo purpose validation. Physical IO occurs outside locked tx, deleting/deleted objects wait for confirmed old deletion before a new generation writes.
- [ ] Run scoped tests to PASS, plus stop/retry ingest around put/DB commit and verify a single canonical original survives restart. Assert flow descendants do not run before parent completion.
- [ ] Commit `feat(community): ingest upload parts through transactional flows`.

### Task 5: Bounded avatar processing and shared output deduplication

**Files:** create media-worker/avatar.ts, image-child.ts, finalize.ts, main.ts and tests; add pinned direct sharp production dependency/root lock; extend objects.ts for derived objects/recipe relations. Add deterministic safe image fixtures.

**Interfaces:** produce `deriveAvatar(ctx,data):Promise<void>`, `finalizeUpload(ctx,data):Promise<void>`, `processAvatar(inputPath,outputPath,signal?):Promise<{hash:string;size:number;width:512;height:512;mime:"image/jpeg"}>`. RecipeBuild includes exact sharp/libvips versions/config; main consumes same StorageContext and runs ingest/avatar/finalize queues independently of NapCat.

- [ ] Write fixture assertions: rotated EXIF/GPS, CMYK and transparent PNG yield 512×512 JPEG, white flatten/no EXIF/XMP/IPTC/ICC, ≤524288bytes; disguisedSVG/GIF/corruptJPEG, >16M pixels/>8192side/multipageWebP/AVIF and valid animated PNG rejected with correct codes. Actual sharp0.35.5 AVIF metadata is format heif/compression av1; HEIC must remain rejected. The linux-amd64 preflight shows valid APNG has no pages marker, so metadata-only checks are insufficient: add bounded PNG chunk inspection rejecting acTL before decode. Inspect BMFF ftyp with bounded normal/extended box parsing and reject avis in major/any compatible brand before accepting static avif; heif/av1 and a single page remain necessary. Reject missing/malformed/oversized headers failclosed and document the4096-byte header cap; actual official animatedAVIF/HEIC fixtures are available in infra-linux-sharp-report.md. Test actual container validation, not renamed fixtures. Child timeout30s kills process and releases worker capacity. A cancellation/user deletion during processing never finalizes or publishes.
- [ ] Write real-PG/S3 shared-output tests using distinct input bytes yielding identical output: one derived_objects row and physical budget charge; two source recipe rows point to it; winner failure/retry and lease expiry converge. Ready file/session plus reserved→used is atomic and replay does not double charge.
- [ ] Run to FAIL; implement sharp child with `failOn:'warning'`, `limitInputPixels:16000000`, auto rotate/sRGB/cover/flatten/jpeg85/nonprogressive and no keepMetadata. Bound child wall clock/temp disk, validate format/compression/pages and bounded container animation markers before complete decode; enforce side8192 separately from limitInputPixels. Use independent derived physical generation and lease, not source lease, to put/verify/hash-byte key. Finalize remains private/unattached; retryable failures throw and permanent failures terminalize flow.
- [ ] Run scoped tests to PASS, load and process a fixture in actual linux/amd64 production image, record recipeBuild and native versions. No full-file memory buffers for general originals.
- [ ] Commit `feat(community): process safe deduplicated avatar derivatives`.

### Task 6: Explicit avatar mutations, private reads and public streaming

**Files:** create storage/avatars.ts, references.ts, files.ts, range.ts, public-media.ts, drain.ts and tests; api/files.ts, avatar.ts; modify app.ts, api/v1.ts, services/profile.ts, auth/auth.ts and test fixtures; add explicit pinned production @hono/node-server2.1.1 dependency/root lock for exact streamed HTTP transport checks.

**Interfaces:** produce `setAvatar(ctx,userId,{fileId:string|null,expectedRevision:number},idempotencyKey):Promise<AvatarDto>`, `getFile(ctx,userId,fileId):Promise<FileDto>`, `deleteFile(ctx,userId,fileId):Promise<void>`, `resolvePrivateFile(ctx,userId,fileId,representation:"content"|"preview")`, `createPublicMediaHandler(ctx,drain)`, `createMediaDrain({db,secret}):MediaDrain`. HTTP uses PUT `/me/avatar` for save and DELETE `/me/avatar` for removal, both through the mutation service and their distinct request digests. DELETE `/files/:id` soft-deletes unreferenced own files/idempotently returns204; business references produce409 FILE_IN_USE. Registry `FILE_REFERENCES` initially holds avatar reference/public-representation/retention checks; include an explicit registration test for future business modules. MyProfile gains image/avatarRevision. Internal handler accepts POST /internal/media/{drain,resume}, bearer-only internal :3001 listener.

- [ ] Write real-PG mutation tests: expectedRevision conflict409, active status rechecked, same key/body lost-response replay same result without increment, changed-body conflict, replacing/removing oldfile retains24h, same-file no-op, shared output stays public until last active reference, revoking output can't republish. Better Auth generic update-user image cannot bypass association/projection.
- [ ] Write HTTP read tests asserting owner/private404 (including ETag/Range), public output reveals no original access; GET/HEAD exact path, query/method invalid no-store, MIME/length/ETag/security headers/noCookie/noVary, single range/suffix416/multiple416 and If-None-Match/If-Range. Storage stream failure503 or interrupted response, never stale authorization304.
- [ ] Run to FAIL; implement avatar mutation locks and immutable derived URL projection with durable outbox on last-reference removal. Stream via Task2 driver after permissions; use tested range helper for public/private. All private/negative responses no-store; preview is processed bytes behind login, original attachment filename sanitization uses RFC filename*.
- [ ] Implement drain registration before asynchronous permission lookup, per-hash latch and abort set, authenticated drain ACK with generation; resume requires PG current public generation. Bound in-flight registration through stream end/cancel; do not send session middleware through /media. Tests hold permission lookup at barrier, drain, then release it and assert no origin body/cookie escapes.
- [ ] Run scoped tests to PASS; no public POST/user-controlled filenames and no host exposure of internal listener. Real multi-chunk HTTP checks run under Bun1.4.2 using @hono/node-server2.1.1 with overrideGlobalObjects:false, proving accurate Content-Length/backpressure/cancel without buffering. Native Bun.serve currently strips Content-Length for such streams; preserve the actual repro and do not claim production entrypoint switched until Task11. A single post-commit onMediaPublished callback uses the same authenticated MediaDrain resume path and rechecks current public generation/active references; stale notifications are no-op, obsolete idempotency success still returns its original DTO, current-generation delivery failure is typed503 repairable by the same key. Configure a context clone, never mutate a shared context or invoke notification under TX; Task8 restoration notifies after its outer commit.
- [ ] Commit `feat(community): publish avatars with private original permissions`.

### Task 7: Durable bounded Cloudflare revocation

**Files:** create worker/media-purge.ts + tests and storage/publication helpers as needed; modify worker/main.ts and queue readiness only for control integration. Add minimal typed durable attempt evidence to the existing purge outbox schema with an additive migration/snapshot and behavioral tests; do not rely on process memory or logs.

**Interfaces:** produce `revokeMedia(ctx,{hash,generation},deps:{fetch,sleep,now,drainUrl}):Promise<void>` and outbox repair. Secret read only from control config; canonical URL derives from validated public origin/hash. Current revoking publication completes to private; a current blocked publication uses the same full bounded evidence sequence and completes its outbox while remaining blocked, never unblocking it. Only effective public references count; generation/attempt/reference checks apply to both states. Use a task-local dedicated checked-out PG client with bounded acquisition, transaction and COMMIT; normal steps have 59s of the 60s attempt budget, reserving 1s for fenced failure settlement. Timeout/disconnect does not prove remote COMMIT rollback; retain durable incomplete evidence and reconcile. Dead-letter data has only hash/generation, so its consumer records safe observations without rewriting any attempt evidence/state; bounded hourly outbox repair and existing deadqueue counts retain visibility.

- [ ] Write timeline tests using injected clock/fetch and real PG: ACK currentgeneration, two successfulpurges times≥5s, two canonicalanonymousGET404/nonHIT times≥5s, final lockedgeneration/referencecheck →private/done. Inspect requests: no Cookie/Auth/range/conditions/query/cachebuster on probes, max64KiB body; non404 immediatelycancel. Any ACK/purge/probe timeout/failure/200/HIT/generationchange keepsrevoking; ≤60s total and ≤2purges/2probes. Shared new reference cannot be erased by stale completion.
- [ ] Run to FAIL; implement fixed sequence with individual10s cancellation and whole60sdeadline, durable evidence/errorcodes and safe logs. Failed/dead outboxes stay visible and hourlyrepair requeues; old-generation requests no-op without overriding current publication. Do not call real Cloudflare for unit tests. Fence evidence/final/error writes by current attempt as well as generation; reset evidence on a fresh claim. Request/body timeouts consume the remaining monotonic whole-attempt budget, including DB work and the two5s delays; deadline failure staysrevoking.
- [ ] Run scoped tests to PASS including origin permission/drain fill race from Task6. Live production edge test is deferred to Task12 and must use owned acceptance media rather than another user's image.
- [ ] Commit `feat(community): revoke public media through durable purge outbox`.

### Task 8: Dead-letter convergence, GC and account deletion hooks

**Files:** create worker/storage-sweep.ts, storage-delete.ts, storage-journal.ts, storage/deletion.ts and tests; modify services/user-deletion.ts, api/me.ts cancellation-handler mapping, app.ts configured registry integration, worker/main.ts and user-deletion tests. Extend existing storage producer helpers only for the named lifecycle/generation/reference seams; reuse physical properties for durable deletion uncertainty rather than adding a new platform.

**Interfaces:** produce `sweepStorage(ctx):Promise<SweepResult>`, `deleteStorageObject(ctx,{kind:"blob"|"derived",id,generation}):Promise<void>`, `createStorageDeletionHandler(ctx):DeletionHandler` and prepare/restore hooks. Extend DeletionHandler optional `prepare(userId,tx)`/`restore(userId,tx)`; cancelDeletion consumes handlers. Tombstone writing stays in business tx; journal exporter handles external encryption outside tx. Add optional beforeTransaction queue readiness outside all lifecycle transactions; createDeletionHandlers(ctx,businessHandlers) validates reference deletion partners and keeps storage last. Deferred restoration reuses suspendedAt and bounded hourly sweep; postcommit current-public delivery repair and cancellation replay notify only current association/generation, with a fair bounded scan and missing actual callback as503. Control callback delivery and encrypted journal consumer are completed in Tasks10/11, never acknowledged by a placeholder. Physical DELETE writes a durable started/uncertain marker before external IO; only uninterrupted first success permits refund/deleted, uncertain timeout/crash retains deleting/charge until externally confirmed quiescence. Stranded flow replacement cancels old jobs, increments session generation and enqueues atomically without changing reservation; dead handling verifies actual original job/current flow identity.

- [ ] Write PG tests: dead parent plus blocked descendants reject session/release once/cancelremainingjobs;15minstrandedprocessingrepair;24hexpiry;hourlylimits100/batch1000/10min;tempterminal1h/unknown48h;unattached24h/tombstone30d;seven-dayorphans. Each boundary test asserts state/budget/object identity, using injected clock rather than slow sleeps.
- [ ] Write concurrency tests for original/derivedGC versus new references and oldDELETE/newPUT: one generation winner, no deleted valid avatar, sharedoutput stays until allsource/associationleases gone. DB tombstones remain until external delete succeeds;404delete isidempotent. Budget recalibration exposesdrift; missing readyobject isstoragefailure, never silentlyrefundquota.
- [ ] Write account tests: avataronlyhasContentfalse;requestdeletiontransaction cancelsuploads/revokesimage/enqueuesoutbox evenafterusergone;cancelrestoreseligibleoldavatarbutnevercancelledsession;finalpurge alwayssoftdeletesavatars regardlessdeleteContentfalse;anonymousfuturefixtureFKprotectsfiles;noexternalIOinsidepurgeUsertx. Assertworker cannotpublishafterrequestdeletionrace.
- [ ] Run to FAIL; implement locks/physicalgenerationrules, maintenance participation, prepare/restore/purge hooks and control worker schedules `missed:'once'`, tombstones/minute journal export, explicit registry test. Acquire storage admission at each outer request/cancel/purge transaction boundary before its existing user lock; hooks use that same transaction, not a new connection. Map deletionHandlers to handlers explicitly for cancellation. Keep NapCat handlers/connection unchanged.
- [ ] Run scoped tests to PASS with real pg-boss drain/sweep retries and realS3GC fixtures.
- [ ] Commit `feat(community): converge storage cleanup and account deletion`.

### Task 9: Streaming browser hash and avatar profile experience

**Files:** create client/workers/file-hash.ts, lib/file-upload.ts, queries/storage.ts, components/avatar-upload.tsx + tests and DOM tests; modify components/avatar.tsx/all Avatar call sites, routes/settings-profile.tsx, messages/{zh,en,ja}.json and profile DTO tests.

**Interfaces:** produce `hashFile(file:File,{signal,onProgress}):Promise<string>` through dedicated worker with pinned incrementalSHA256 library; `createUploadController({api,userId,storage,onState}):UploadController` (start/resume/cancel/dispose); querykeys `['me','uploads',id]`, `['me','files',id]`; Avatar accepts nullableimage and fallsbackexistingSVG.

- [ ] Write controllertests:1MiBhashreads (wholefilearrayBuffernevercalled),ready-part-basedprogress,outoforder/reselectsamehashresume,wrongfilecannotresume,cancelaborts+DELETE,accountisolatedlocalStorage(no bytes/tokens),logoutclearsrecords. Processingpoll2s→5safter1min,hiddenpause/visibleimmediate,terminalstop. Lostsuccessresponsesreplayidempotently.
- [ ] Write DOMtests:localpreview→processedprivatepreview→explicitSave;invalidimage/failurepreservesoldavatar;remove/default;expectedRevisionconflictrefreshandtranslatedmessage;saveindependentnicknamevalidation;all3langs;imagesfailuredefaultSVG and aria-hiddenbehavior atprofile/menu/headers. Tests query user-facing accessible controls.
- [ ] Run to FAIL; implement workerincrementalhash with exact @noble/hashes 2.4.0 (sha256.create().update(Uint8Array).digest(), explicit sha2.js sub-import; known vectors and bounded-worker probes already passed), API-onlycontroller and profilecomponent. Persistonly id/name/size/hash/expiry scopeduser. RevokeobjectURLs and stopworkers ondispose. Saveinvalidates ['me'] and publicuserquery, replayresultstillrefreshescurrentprofile.
- [ ] Run targetedBun+VitestDOM to PASS, compileParaglide/typegen. Verify worker startup and hashing under the existing enforced CSP without adding unsafe-eval/wasm-unsafe-eval; inspect desktop/mobileprofile in testbrowser; capture screenshots of changed UI. No added E2Eplatform.
- [ ] Commit `feat(community): add resumable avatar upload experience`.

### Task 10: Consistent original backups and fail-closed recovery

**Files:** create storage/maintenance.ts, backup.ts, recovery-web.ts + tests; ops/backup/export.ts, restore.ts, journal.ts and runbook; modify backup.sh/Dockerfile + backup tests, README/privacy messages and existing timer install docs only when semantics require.

**Interfaces:** maintenance functions acquire/renew/release boundedlease and dedicated advisoryexclusiveconnection after mutations' sharedlocks; admission closes via sharedadvisory + maintenance row FOR UPDATE then commits; a narrowly typed existing-lease completion path may drain under the gate only after current generation/lease validation (no caller boolean bypass); exporter produces versioned manifest (policy/hash/key/size/mime/recipe) and verified originalstaging; journal encrypts append-only minimal tombstones into persistent outside-snapshotpath with sequence/hashchain. Restorer requires verified latestjournal and a private persistent restore interlock outside restored PG/Seaweed/bundle paths. Missing/malformed/uninitialized state fails closed; Task11 explicitly initializes a fresh installation. Normal bootstraps refuse startup while closed. Stop/confirm normal web and workers before replacement, replay latest account/revocation tombstones offline, then use a minimal recovery-web entrypoint in the same image/service: only canonical media denial404/no-store, the actual authenticated internal drain and health; no auth/SSR/API/private bootstrap or normal job claims. Run existing revokeMedia directly for restore-owned affected outboxes with unchanged strict evidence. Stop recovery, verify invariants, and atomically open only after success; failure never opens in finally. Normal backups keep reads available.

- [ ] Write truePG/S3 tests:in-flightwriterdrainsbeforemanifest/dump;newmutations503while readswork;missing/hashwrongoriginalfailsfullsnapshot;verifiedreadonlystagingreuse;maintenancetimeout≤5min/wholejob≤30minreleasesbarrier;resticfailure no prune/completion. Preflight actual missing staging bytes plus PG dumps and worst-case new restic bytes against available disk, retaining the 5GiB floor; insufficient space fails before opening a full backup. Assertderived/tmp absent, taggedcommunity-full, oldDBonlyretained.
- [ ] Write recoveryfixture:fullsnapshotofavatars thenaccountdeletion/exportlatestjournal;restoretofreshPG/Seaweedvolumes+rebuild fixedrecipe;deleteduser/publicmedianeversurfaces, cancelledtmpuploadsquotareset,originalhash/permissionscorrect. Journalmissing/gapsequence/authenticationfailurekeepspublicmediaclosed and normal auth/profile inaccessible. A valid old signed head is not freshness proof: trusted latest head comes from the outside-snapshot journal or forced source flush, never from the restored bundle. Verify source stop/closed-state restart/recovery-mode isolation, real drain/purge/canonical404 evidence and no-data behavior before open. Outputhashdriftgeneratesnewkey/projectionandneveroverwritesoldimmutablekey.
- [ ] Run to FAIL; implement boundedbackuporchestration and journals with no secrets/stdout;originalexportstreamshashandatomicstagingrename, consistentPGsnapshotinsidebarrier. A journal sequence checkpoint alone is insufficient because identity allocation is not commit order: exporter uses a short exclusive storage-advisory visibility barrier, draining all shared-lock tombstone writers before reading committed rows/checkpoint. Test transactionA allocates lowersequence and waits, B commits highersequence, exporter waits for A, then exports both; rollbacks may leave harmless numeric gaps. Ensureexclusive connection/leasefinally and workerpause;failedrestoredoesnotopenwrites/media. Document actualretention and existingbrowsercopies in zh/en/ja privacy.
- [ ] Run scopedtests to PASS and one wholeisolatedfresh-volume restore; record elapsedRTO and dailybackupRPO from measuredrun. Nooffsite configuration or newtimerduplicate.
- [ ] Commit `feat(community): back up originals and replay deletion journals`.

### Task 11: Pinned production services, role credentials and deploy checks

**Files:** create ops/seaweed/write-config.ts/tests and storagehealth command; modify compose.yaml/compose.dev.yaml, Dockerfile, .env.example, fill-secrets.sh/tests, deploy.sh/tests, package scripts/README, vite.config.ts and CI service wiring where required. Wire server/index.ts, worker/main.ts and media-worker/main.ts to their separate role contexts/readiness/lifecycles, with backup runtime integration established in Task10. Preserve NapCat overlay production workflow.

**Interfaces:** SeaweedFS pin is `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` (official registry verified via proxy, amd64 manifest `sha256:aba492e2a4e4c90bff795745e8e660affa1f09e7650f5981bd7bccd1a06cd931`). The image entrypoint supplies `weed`, so compose command begins `mini -dir=/data -s3.port=8333 -bucket=blobs,derived -s3.config=/config/s3.json`. Use0600roleconfigurationinitvolume; web/media/control/backup receiveonlytheirrolekeys; mediaworker sameappimage separatecommand and healthheartbeat; internalweb:3001unpublished. The existing public web listener uses react-router-hono-server/node under Bun1.4.2 and the exact @hono/node-server2.1.1 adapter to preserve known-length streaming; Vite runtime matches node, global Request/Response replacement is disabled. Explicitly prevent Bun CLI auto-serving a default Hono.fetch export and implement the actual node server shutdown/abort/drain cleanup; no extra public listener, side proxy or host port. Configure validated post-commit media resume for actual web/control publication/restoration callers.

- [ ] Write opbehavior tests:fillsecretsneverprintsvalues/reusesexistingkeys/0600config/noanonymousidentity;composehasnoSeaweed/internalhostports/newtunnel;NO_PROXYseaweedfs;controlaloneCFpurgetoken;mediacpu/memory/disktmpstopgrace≥45s;backupreadonlyrole;newdeployrequiresmediaprocesshealth/signedbothbuckets/queues, retainsoldrollbackimage and NapCatreuseoverlay.
- [ ] Run to FAIL; pinstableimage afterofficialmetadata+amd64digestverification;bootstrapauthenticatedfromfirststart, noAllowAllinterval. TestactualACLprefixcapability and documentbucketfallbackifneeded. Native sharp/dependenciesincludedrunner; no secretsbakedimage. DevtestSeaweedhostbindingonly127.0.0.1usingdistinctport, non-productionvolume. Production capacity gate includes object budgets, verified-original staging, restic growth and 5GiB floor. The 2026-10-10 read-only g510 snapshot has38.28GiB user-available on one shared disk, insufficient to guarantee a full20GiB-original allocation plus a full staging/restic copy; do not silently reduce approved defaults or claim production capacity accepted.
- [ ] Run composeconfigvalidation, scopedopstests, actuallinux/amd64build/nativefixture, restartpersistence/anonymous403/APIcompatibility/mediastopandresume; real built-server SSR/auth/body-limits/private/public multi-chunkContent-Length/backpressure/disconnect/drain and shutdown tests prove the transport switch, single listener and cleanup; checkg510freespace before any rollout. Do notdeploy publicly untilTask12acceptancepasses and concretechangesreviewable.
- [ ] Commit `ops(community): deploy authenticated storage and media worker`.

### Task 12: Full integration, review and production readiness record

**Files:** add `test/storage/integration.test.ts`, extend `test/http/storage.test.ts`, acceptance/runbook/evidence docs; fix only reviewed findings within owned modules.

**Interfaces:** consume the completed feature, not newproductscope. Final review checks allspec§16classes and everyTaskcompletionledger; run actualHTTPthroughbuiltserver and actualPG/Seaweed with isolatedcredentials.

- [ ] Run `bun run check`, `bun run build`, `bun run test:http`, storageintegration/ops and nativeamd64 checks. PASS includesexistingauth/QQ/profile/deletion/Umamicases, and fullupload→privatepreview→save→publicbytes→remove→purge/GC flow. Fixturehashes no privateuserphotos.
- [ ] Run failurematrix:PGrollback/S3restart/droppedbody/killedchild/lostlease/deadletter/retry/cancel/quota/physicalbudget/sharedhashGC/maintenance/restoregap. Record actualstatuses and invariants, not sourcecoveragecounts.
- [ ] Obtain one wholebranchindependentcode+specreview, fix in onecompletefindingsdispatch, scopedrereview; ledgeranyremainingdecisions and costs. `git diff --check` and worktreecleanafterexplicitcommits. No publicpush.
- [ ] Prepare concreteproductionrollout:exactimage/migrations/envkeynames withoutvalues, rollback/data-backup steps, temporaryownedtestmedia andCloudflarecanonicalcache acceptance (APIbypass/mediaqueryblock/negative404nostore/publicHIT/privateNOHIT/removeedge404). Credentials/setup requiringuserinput are requested only afterworkisreviewable; existing authorization applies to routine reversiblerollout. Productionpurgetoken is a newscopedsecret, never request it inchat.
- [ ] Execute authorizedrollout only aftersuccessfulisolatedchecks, verifyg510existingservices/NapCatpreserved andnewweb/media/control/Seaweedreadiness, measurefirstfullbackup/restore; recordactualpublicedgeoutcomes andlimitations. Ifexternalcredential ismissing, keep currentproductionrunning and completedcode reviewable; neverclaimpublicacceptancepassed.
- [ ] Commit acceptance docs and report finalcompletedwork, verification, materialremainingexternalinputs, localbranchandplan; leave Dashdraftunpublished and manualTurnstilestatusindependent.

## Plan self-review (controller, before implementation)

Spec coverage: §§1–5 map to Tasks1–3/5/9/11; §6 to1/3/5/6/8; §§7–8 to3/4/6/9; §9 to4/5/8/11; §10 to6/7/12; §§11–12 to8; §13 to10; §14 to2/7/11/12; §15 to9; §16 to12. Signed-share creation and platform avatar imports stay explicitly deferred by the approved spec.

Interfaces: ObjectDriver/StorageJobData are established inTask1 and consumedunchanged; Task6 adds only the optional post-commit media-publication callback to StorageContext, with actual role wiring inTask11; complete isaddedinTask4 ratherthan a fakeTask3acceptance; shared-outputphysicalgenerationisownedbyobjects.ts andusedbyTasks5/8. Deletionprepare/restoreextendsbothrequest/cancelpaths. AllmodulesmutatingstorageusetheTask1sharedmaintenance-lockhelper, whileTask10aloneownstheexclusiveconnection/lease.

Review Focus tests are pinnedtoTasks3/4/6,3/5/8,5/8,6/7,10 respectively. Tests useactualDB/S3 foratomicity/permissions/durability, injectclock/networkonlyforboundedtiming and remoteCDNsequencing. No mirroredtestsor anadditionalE2Eplatform. The plan islargerthan the375linespec onlyby task/checkableinterface structure; it doesnottranscribeimplementationbodies.
