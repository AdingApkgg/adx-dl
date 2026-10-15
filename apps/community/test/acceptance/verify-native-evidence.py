"""Strict offline audit of private native samples; never silently skip unhealthy rows.

A healthy finite sample window is not a complete native acceptance result. Complete
coverage additionally requires timestamped readiness, final health, and sampling /
application logs through the explicit shutdown request. This tool never starts services.
"""
import argparse
import datetime
import json
from pathlib import Path

SERVICES = ("postgres", "redis", "seaweedfs", "web", "media", "control")
ROLES = {"web", "media", "control"}
CGROUP_FIELDS = ("memory.current", "memory.peak", "memory.events", "memory.max", "cpu.stat", "pids.current", "pids.events")


def stamp(value):
    if isinstance(value, (int, float)):
        return float(value)
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def iso(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()


def read_events(paths):
    events = []
    for path in paths:
        for line in Path(path).read_text().splitlines():
            if '{"diagnostic":' in line:
                event = json.loads(line[line.index("{"):])
                if event.get("role") and event.get("event") in (
                    "query_error", "query_sync_error", "connection_error", "heartbeat_row_miss"
                ):
                    events.append({key: event.get(key) for key in ("time", "role", "event", "code", "type", "message")})
            elif line.partition(" ")[2].strip() == "STORAGE_ROLE_LOST":
                events.append({"time": line.split(" ", 1)[0], "event": "STORAGE_ROLE_LOST"})
    return events


def audit(rows, start, end, *, events=(), lifecycle=None, max_gap=3):
    start, end = stamp(start), stamp(end)
    if end < start:
        raise ValueError("Observation end precedes start")
    audit_end = stamp(lifecycle["shutdownRequestedAt"]) if lifecycle else end
    selected = [row for row in rows if start <= row["time"] <= audit_end]
    nominal = [row for row in selected if row["time"] <= end]
    errors, gaps = [], []
    counters = {"failedPgProbes": 0, "nonThreeRoleSamples": 0, "missingRoleSamples": 0,
                "missingContainerSamples": 0, "incompleteCgroupSamples": 0, "failedOrMissingHttpReadySamples": 0}
    http_observed = any("httpReady" in row for row in selected)
    expected = None
    peak, ages = {name: 0 for name in SERVICES}, []
    if not selected:
        errors.append("no_observation_samples")
    for index, row in enumerate(selected):
        tick = row.get("tick", index)
        if http_observed:
            ready = row.get("httpReady", {})
            if ready.get("ok") is not True or ready.get("status") != 200:
                counters["failedOrMissingHttpReadySamples"] += 1
                errors.append(f"http_ready_failed_or_missing:{tick}")
        if index:
            gap = row["time"] - selected[index - 1]["time"]
            gaps.append(gap)
            if gap <= 0 or gap > max_gap:
                errors.append(f"sample_gap:{tick}")
        pg = row.get("pg", {})
        value = None
        if pg.get("code") == 0 and pg.get("out"):
            try:
                value = json.loads(pg["out"])
            except (TypeError, ValueError):
                pass
        if not isinstance(value, dict):
            counters["failedPgProbes"] += 1
            errors.append(f"pg_probe_failed_or_missing:{tick}")
        else:
            roles = value.get("roles") or []
            if len(roles) != 3:
                counters["nonThreeRoleSamples"] += 1
                errors.append(f"role_count:{tick}")
            if {r.get("role") for r in roles} != ROLES:
                counters["missingRoleSamples"] += 1
                errors.append(f"role_set:{tick}")
            else:
                identity = {r["role"]: r.get("pid") for r in roles}
                if expected is None:
                    expected = identity
                if identity != expected or any(v is None for v in identity.values()):
                    errors.append(f"role_session_changed_or_missing:{tick}")
            for role in roles:
                age = role.get("age")
                if not role.get("locked") or not isinstance(age, (int, float)) or not 0 <= age < 3:
                    errors.append(f"role_unhealthy:{tick}:{role.get('role')}")
                if isinstance(age, (int, float)):
                    ages.append(age)
        for name in SERVICES:
            container = row.get("containers", {}).get(name)
            if not isinstance(container, dict) or "state" not in container:
                counters["missingContainerSamples"] += 1
                errors.append(f"container_missing_or_error:{tick}:{name}")
                continue
            if not container["state"].get("Running") or container.get("restarts") != 0:
                errors.append(f"container_not_running_or_restarted:{tick}:{name}")
            cg = container.get("cgroup", {})
            if any(not cg.get(field) for field in CGROUP_FIELDS):
                counters["incompleteCgroupSamples"] += 1
                errors.append(f"cgroup_incomplete:{tick}:{name}")
                continue
            try:
                memory_events = dict(line.split() for line in cg["memory.events"].splitlines())
                if "oom" not in memory_events or "oom_kill" not in memory_events:
                    raise ValueError("missing OOM counters")
                if int(memory_events["oom"]) or int(memory_events["oom_kill"]):
                    errors.append(f"oom:{tick}:{name}")
                peak[name] = max(peak[name], int(cg["memory.peak"]))
            except (ValueError, TypeError):
                errors.append(f"cgroup_invalid:{tick}:{name}")
    coverage = []
    if not lifecycle:
        coverage.append("timestamped_http_readiness_and_intentional_shutdown_not_recorded")
        tail_end = float("inf")
    else:
        tail_end = stamp(lifecycle["shutdownRequestedAt"])
        if tail_end < end:
            errors.append("shutdown_precedes_observation_end")
        if not lifecycle.get("ready", {}).get("ok"):
            coverage.append("explicit_http_readiness_missing")
        elif stamp(lifecycle["ready"]["at"]) > start:
            errors.append("observation_precedes_declared_ready")
        final = lifecycle.get("finalHealth", {})
        if not final.get("ok") or "at" not in final:
            coverage.append("final_health_missing_or_failed")
        elif not 0 <= tail_end - stamp(final["at"]) <= max_gap:
            coverage.append("final_health_does_not_cover_shutdown")
        if not selected or selected[0]["time"] - start > max_gap or tail_end - selected[-1]["time"] > max_gap:
            coverage.append("samples_do_not_cover_ready_through_shutdown")
        if not lifecycle.get("applicationLogsCollectedThroughShutdown"):
            coverage.append("application_tail_logs_incomplete")
    relevant = [e for e in events if start <= stamp(e["time"]) <= tail_end]
    in_window = [e for e in relevant if stamp(e["time"]) <= end]
    after_window = [e for e in relevant if stamp(e["time"]) > end]
    if relevant:
        errors.append("application_failure_before_intentional_shutdown")
    return {
        "status": "failed" if errors else "incomplete" if coverage else "passed",
        "totalSampleCount": len(rows), "windowSampleCount": len(nominal), "checkedSampleCount": len(selected),
        "outsideCheckedIntervalSampleCount": len(rows) - len(selected), "skippedWithinWindow": 0,
        "windowStart": iso(start), "windowEnd": iso(end),
        "windowSampleSpanSeconds": round(nominal[-1]["time"] - nominal[0]["time"], 6) if nominal else 0,
        "maxSampleGapSeconds": round(max(gaps, default=0), 6),
        "windowSampleChecksPassed": not any(not e.startswith("application_failure") for e in errors),
        "counts": counters, "maxRoleHeartbeatAgeSeconds": max(ages, default=None),
        "peakMemoryBytes": peak, "applicationFailuresWithinWindow": in_window,
        "applicationFailuresAfterWindowBeforeShutdown": after_window,
        "coverageGaps": coverage, "errors": errors,
        "continuousHttpReadinessMeasured": http_observed and bool(selected),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--role-log", action="append", default=[])
    parser.add_argument("--lifecycle")
    args = parser.parse_args()
    result = audit([json.loads(line) for line in Path(args.samples).read_text().splitlines()], args.start, args.end,
                   events=read_events(args.role_log), lifecycle=json.loads(Path(args.lifecycle).read_text()) if args.lifecycle else None)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["status"] == "passed" else 1)
