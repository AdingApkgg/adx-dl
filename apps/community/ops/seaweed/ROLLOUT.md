# Avatar storage release acceptance and operator handoff

Release branch: `codex/community-storage-design`. The serving production baseline is `1e07466818604fde7171bc8460772fe51e9683bf`; local acceptance does not authorize an unsupported-capacity deployment. Read `README.md` in this directory and `../backup/README.md` together with the final acceptance record. Do not publish the Dash draft or change the existing NapCat reuse overlay.

## Capacity decision before rollout

The 2026-10-11 read-only g510 observation is 38.41 GiB available. It does not meet the approved conservative first demand of 71 GiB plus both bounded database dumps and growth. Keep current budgets: 20 GiB originals, 2 GiB derived, 2 GiB temporary objects, separate disk-backed scratch at most 2 GiB, verified staging up to 20 GiB, worst-case new restic data up to 20 GiB and the 5 GiB free floor. The retained originals can conservatively reach 340 GiB over the unchanged daily/weekly/monthly window, before dumps and metadata; deduplication is not guaranteed.

Operator choices are concrete: enlarge the shared backing pool to cover aggregate first demand and retention planning, or provision verified independent storage for objects, staging/bundles and repository. Record the backing-pool relationship, mounted paths, total/available bytes and dump bounds. Distinct `st_dev` values alone do not prove separate btrfs/thin backing capacity. Do not count preallocated/existing bytes twice or silently reduce budgets. Run the existing live capacity preflight after provisioning.

## Configuration and build inventory

Use the exact reviewed release commit in the final acceptance record. Build from the repository root with the pinned Dockerfiles:

```sh
docker build --platform linux/amd64 -f apps/community/Dockerfile -t astrodx-community:RELEASE_SHA .
docker build --platform linux/amd64 -f apps/community/ops/backup/Dockerfile -t astrodx-community-backup:RELEASE_SHA .
```

Record both immutable image IDs, the full source commit, Compose configuration and current production image ID before update. App migrations are additive through `0008_storage_runtime_roles.sql`; `bun run db:migrate` is run by the existing deployment path. Do not revert database tables as an application rollback step.

Required external operator inputs are the capacity layout/dump bounds and a Cloudflare zone-scoped cache-purge token. Install the token directly into the server's private environment with mode0600; never send it in chat or commit it. Key names (values omitted): `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_TOKEN`, `STORAGE_WEB_ACCESS_KEY_ID`, `STORAGE_WEB_SECRET_ACCESS_KEY`, `STORAGE_MEDIA_ACCESS_KEY_ID`, `STORAGE_MEDIA_SECRET_ACCESS_KEY`, `STORAGE_CONTROL_ACCESS_KEY_ID`, `STORAGE_CONTROL_SECRET_ACCESS_KEY`, `STORAGE_BACKUP_ACCESS_KEY_ID`, `STORAGE_BACKUP_SECRET_ACCESS_KEY`, `STORAGE_INTERNAL_MEDIA_SECRET`, `STORAGE_MEDIA_SCRATCH_DIR`, `STORAGE_COMMUNITY_DUMP_BOUND`, `STORAGE_UMAMI_DUMP_BOUND`, `RESTIC_PASSWORD`, `RESTIC_REPOSITORY`, `STORAGE_JOURNAL_DIR`, `STORAGE_JOURNAL_KEY_FILE`, `STORAGE_RESTORE_STATE_DIR`, `STORAGE_STAGING_DIR`, `STORAGE_BUNDLE_ROOT`. Existing database/auth/NapCat values remain server-local. Exact Compose mount mapping and remaining defaults are in `.env.example` and `compose.yaml`; only control receives purge credentials.

## Ordered rollout

1. Save the baseline image ID, both current DB dumps and existing backup/repository state. Verify NapCat/Umami/community health and the reuse overlay before changes. Preserve `COMPOSE_FILE=compose.yaml:.superpowers/napcat-reuse.compose.yaml`; do not run `compose down` or remove orphans.
2. Provision the approved capacity and bounded disk scratch. Build the reviewed images and run additive migrations before initialization. Generate role configuration with `storage-config`, start only SeaweedFS and run explicit `storage-init` once for empty state. The initializer atomically creates or validates enabled `primary-web`/`primary-media` metadata with exact namespace and role references; it receives only backup credentials. It rejects mismatched/disabled policies and any existing storage usage. An already-used database with missing external journal/state requires recovery, never first-install initialization. Verify signed bucket readiness, anonymous403, mode0600 key/config and external journal/state placement.
3. Build the exact reviewed images, run migrations and the existing `backup bun ops/backup/preflight.ts` gate. Preserve actual prior serving image using the existing deploy script. Update only the intended web/control/media roles after all prerequisites pass. Verify `/readyz` and the media health command, then existing login/profile/QQ/NapCat/Umami behavior.
4. Run the first actual `community-full` backup under all three current role ACKs. Record maintenance/backup time and original/dump sizes. Restore it into fresh isolated volumes using the documented closed-state ownership procedure and latest authenticated journal; record measured RTO. Keep the existing 03:30 timer and retention7daily/4weekly/6monthly; no offsite claim.
5. Use an owned temporary account and synthetic fixture image for the public edge acceptance below. Remove the avatar and file, allow the existing retention/GC rules to clean up; do not use personal photos or delete unrelated media.

## Required Cloudflare acceptance record

Before the first public avatar, configure `/api/*` cache bypass and query rejection on `/media/`; preserve canonical cache keys and no cookie/auth variations or image transforms. Record request timestamps/status/cache headers without cookies or tokens. First anonymous nonexistent canonical URL must be404/private,no-store and never HIT. Upload a valid fixture including a4MiB part; owner preview must be200/private,no-store and anonymous preview denied; API/private requests must never HIT. Explicit save then yields real JPEG bytes with output SHA/ETag and a subsequent canonical public HIT. Query variants remain blocked. Remove the final public association: require current-generation origin drain ACK, two canonical URL purge successes at least5s apart and two anonymous canonical404/non-HIT probes at least5s apart, plus durable done/private state. A local API timing fixture is not this edge proof. Existing browser copies cannot be recalled.

## Rollback and recovery

For a startup/readiness failure before new writes, the deployment script retains the previous actual serving image and additive schema; return web/control to that saved image and preserve all storage volumes/journal/key/state. Stop new media admission and its owned native processes before rollback. Verify old community, NapCat and Umami health. Never overwrite the rollback tag with a failed candidate.

After new avatars/writes exist, preserve a fresh data backup and latest journal first. An old application image is not a data rollback: it can leave public associations/revocations requiring the new control runtime. Keep origin media closed if safe revocation cannot be established, retain the current storage data and use the reviewed fail-closed recovery procedure. Do not delete the external restore lock on PID/TTL/HEAD-absence guesses; require proof that old owned processes and remote IO ended. Database restoration requires both dumps, verified originals, latest authenticated journal, native rebuild, restricted recovery revocation and final invariants before opening.

## Publisher interlock recovery (Ruling 41)

Every journal initializer/exporter/retention publisher creates mode0600 `.publisher.lock` with an owner nonce and syncs it before publication. A successful owner removes only its own inode/nonce after all filesystem operations and the applicable database checkpoint finish. The45s caller deadline still returns a failure promptly; timeout, process death, failed checkpoint or owner replacement retains the marker. Other publishers and restore's latest-journal verification reject it. This can deliberately block backup/restore until operator recovery; it must never be removed because its age/lease expired.

For recovery, stop all journal publishers and every backup/restore caller and keep normal storage admission closed. Save the whole outside-snapshot journal directory, its marker/owner metadata and the current database checkpoint as evidence. Prove the exact former publisher process is reaped and its outstanding filesystem operations have completed; a missing PID, timeout, missing key or absent object by itself is not that proof. Resolve any still-running process or uncertain storage IO before proceeding. No automatic cleanup command is provided for an uncertain owner.

Only after that proof, with all competing callers still stopped, move the exact recorded marker into a private evidence directory (never discard it). Run the existing `exportJournal(journalConfig())` against the original authoritative database and directory as the sole controlled recovery process. It verifies the authenticated head/anchor chain and reconciles any published-but-uncheckpointed suffix against the exact committed tombstone rows before advancing the checkpoint. It refuses checkpoint-ahead/head regression or a suffix mismatch. Then run `verifyLatestJournal(journalConfig())` and compare its returned head with `storage_journal_progress`. Do not reopen restore or normal roles until both succeed and there is no publisher marker. If verification/export fails, preserve the new marker if present, otherwise restore the saved exact marker, keep admission closed, and investigate from the saved evidence; never substitute a snapshot's older signed head or hand-edit the checkpoint.

Ruling40 remains first-install-only: `ops/backup/initialize.ts` creates/validates the two exact unused WEB/MEDIA namespace policies with backup credentials, rejects used DBs, and writes open state last. Its cost is two metadata rows and an explicit setup gate. Ruling41's additional cost is an external durable publisher marker and possible manual recovery after uncertain failure; no TTL-based ownership loss or new service is introduced.


After the publisher evidence and reap conditions above have been met and the exact marker has been moved to retained evidence, run this sole recovery check from `apps/community` with the same Compose overlay and original database/journal mounts (all other publishers/restore callers remain stopped):

```sh
docker compose run --rm --no-deps backup bun -e '
import { Client } from "pg";
import { journalConfig } from "./ops/backup/runtime";
import { exportJournal, verifyLatestJournal } from "./ops/backup/journal";
const config = journalConfig();
await exportJournal(config);
const { head } = await verifyLatestJournal(config);
const client = new Client({ connectionString: config.databaseUrl });
await client.connect();
try {
  const { rows } = await client.query("select exported_sequence,chain_hash from storage_journal_progress where id=$1", ["global"]);
  if (rows.length !== 1 || Number(rows[0].exported_sequence) !== head.sequence ||
      (rows[0].chain_hash ?? "0".repeat(64)) !== head.hash) throw new Error("CHECKPOINT_MISMATCH");
  console.log(JSON.stringify({ sequence: head.sequence, hash: head.hash, verified: true }));
} finally { await client.end(); }
'
```

A nonzero result leaves admission closed and follows the evidence/marker restoration procedure above. This command intentionally does not remove a marker or decide that an old process is reaped.

## Raw-interface isolation (Rulings 42–43)

Pinned Seaweed4.48 exposes raw filer, master and volume interfaces independently of S3 ACLs; absence of host ports does not isolate peers on the Compose network. An actual anonymous peer read of a synthetic original through filer8888 returned200. `mini` and standalone `s3` share their HTTP/gRPC bind address, so a separate externally bound S3 process would still expose internal gRPC. The final single-service configuration binds the entire mini process, advertised address and volume lookup to127.0.0.1. The existing BusyBox `nc` accepts only8333 and forwards unchanged bytes to the authenticated loopback S3 port8334. Internal S3 gRPC18334 and every raw interface stay on loopback. Admin UI/WebDAV/Iceberg/Lance are explicitly disabled; pinned mini still starts loopback admin backend listeners23646/33646, which the peer rejection check includes. No additional host port, tunnel, image, service, role credential or privilege is introduced.

`ops/seaweed/entrypoint.sh` supervises mini and relay; TERM/INT stop and wait for both, either main child exit makes the service exit1. Container teardown reaps any connection descendants. `pids_limit:256` bounds the per-connection relay process cost; this is a small deployment transport, with fork/concurrency and throughput limits rather than a general proxy platform. `forward-s3.sh` has no additional whole-transfer deadline or buffering. The existing S3/app deadlines remain responsible for read/write timeouts. BusyBox's documented `-w` wording is “connects and final net reads”; the initially exercised120 setting was removed because that wording did not establish an idle-only semantic. Do not silently add a transfer deadline.

Deploy only after the outstanding fixture restart/INT/child-exit checks and existing acceptance prerequisites pass. Current scoped evidence: actual peer raw-port rejection, anonymous403, all four signed role ACLs and TERM/reap pass; restart command exceeded35s and the remaining lifecycle cases were not run. No production rollout is authorized by these partial results. Rollback must preserve this raw-interface boundary: reverting to externally bound mini reintroduces the confirmed bypass.
