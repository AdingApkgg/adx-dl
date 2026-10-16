# Community storage I/O investigation — 2026-10-16

## Reproduced cause and repair

The build VM uses one shared ext4 virtual disk for verification workspaces,
Docker and PostgreSQL. A dependency installation concurrent with the earlier
native acceptance failure generated enough I/O to delay a real 4 KiB
`fdatasync` beyond the role heartbeat's two-second query deadline.

The verification script mounted its workspace and Bun cache separately. A real
cache-to-workspace `link(2)` returned `EXDEV`, even though both host paths live
on the same filesystem. Bun's documented Linux hardlink backend falls back to
copying files on failure: <https://bun.sh/docs/pm/cli/install>.

The repair mounts the verification root once and places the working directory
and cache beneath that mount. Container image, CPU/memory limits, proxy,
command exit status and run cleanup remain unchanged. This is a trusted-code
container and can see other runs beneath the verification root.

| Controlled experiment | Separate mounts | One shared mount |
| --- | --- | --- |
| Cache-to-workspace hardlink | `EXDEV` | Same device and inode |
| Fresh installation, 820 packages | Still running at 75-second timeout | Completed in 6.87 seconds |
| Probe maximum `fdatasync` | 2174.09 ms | 280.58 ms |
| Probe p95 | 227.42 ms | 34.75 ms |
| Probe observation | 100.19 seconds / 367 samples | 65.06 seconds / 260 samples |

Both installations used the same pinned Bun image, cached dependencies,
2 CPU / 2 GiB limits, frozen lockfile and disabled lifecycle scripts. The old
installation was stopped by its bounded timeout; it did not pass. The new
installation completed normally. Slow-sync wait channels included
`jbd2_log_wait_commit`, `folio_wait_bit_common` and `rq_qos_wait`, identifying
shared journal/writeback/queue contention rather than a CPU or memory failure.

## Verification

- `scripts/remote/verify-storage.test.sh` fails with real `EXDEV` before the
  repair and passes after it. It creates and removes only two test files.
- `scripts/remote/verify.sh` passes its complete lint, UI/web type checks and
  603 tests with zero failures.
- Two further fresh-run installs through the repaired script completed in
  123 ms and 323 ms, including normal run cleanup.
- An independent code review found no blocking issue. The test cleanup was
  strengthened for failure of the second temporary-file creation.

### Five-minute observations after repair

The build observation included the default full verification, two further
fresh dependency installs, and their normal cleanup. The production
observation included the complete backup and read-back described below.

| Observation | Build VM | Physical production machine |
| --- | --- | --- |
| Duration | 300.01 seconds | 300.17 seconds |
| 4 KiB write + `fdatasync` samples | 1189 | 1199 |
| Median | 0.78 ms | 4.58 ms |
| p95 | 3.94 ms | 10.38 ms |
| p99 | 180.93 ms | 67.38 ms |
| Maximum | 1342.54 ms | 445.89 ms |
| Above two seconds | 0 | 0 |
| Readiness failures | Not sampled | 0 |

The probes removed their owned 1 MiB files. Production web/control/media
processes retained their original start times, with zero restarts, OOMs or
`STORAGE_ROLE_LOST` log entries. These bounded observations demonstrate the
measured result; they are not a guarantee against all future disk stalls.

## Production boundary

The physical production machine is separate from the build VM. Its SSD SMART
status passes, the ATA error log is empty, and Btrfs read/write/flush/corruption/
generation error counters are all zero. A fresh complete backup succeeded;
its manifest, both database dumps and all seven original chart files were
read back and matched their sizes and SHA-256 hashes. Runtime role process IDs
remained unchanged and all six readiness checks passed.

Production Btrfs is approximately 93% full and existing 16 MiB PostgreSQL WAL
segments have over 1300 extents. These are capacity/layout risks, not a proven
cause of a reproduced production stall. No database migration, filesystem
rebalance, pruning or global durability change was made during diagnosis.

PVE host administration is unavailable. This investigation proves and repairs
the guest workload amplification; it does not certify the host's physical
storage or promise that unrelated workloads cannot introduce latency.
