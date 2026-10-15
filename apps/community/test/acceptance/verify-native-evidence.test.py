"""Run on the guarded builder with TASK3_RAW_ROOT pointing to preserved private logs.

Tests mutate in-memory copies of actual observations; no services or source data are changed.
Synthetic lifecycle receipts below test verifier behavior, not application acceptance.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("native_evidence", Path(__file__).with_name("verify-native-evidence.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
RAW = Path(os.environ["TASK3_RAW_ROOT"])


class RawEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.rows = [json.loads(line) for line in (RAW / "diagnostic-samples.jsonl").read_text().splitlines()]
        self.start = self.rows[27]["time"]
        self.end = self.rows[-1]["time"]
        self.lifecycle = {"ready": {"ok": True, "at": self.start},
                          "finalHealth": {"ok": True, "at": self.end},
                          "shutdownRequestedAt": self.end, "applicationLogsCollectedThroughShutdown": True}

    def check(self, rows=None, **kwargs):
        return verify.audit(self.rows if rows is None else rows, self.start, self.end,
                            lifecycle=kwargs.pop("lifecycle", self.lifecycle), **kwargs)

    def test_raw_window_has_177_complete_rows_but_no_real_lifecycle_receipt(self):
        result = self.check(lifecycle=None)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["windowSampleCount"], 177)
        self.assertEqual(result["windowSampleSpanSeconds"], 206.99509)
        self.assertEqual(result["skippedWithinWindow"], 0)
        self.assertTrue(result["windowSampleChecksPassed"])

    def test_synthetic_complete_lifecycle_accepts_healthy_raw_copy(self):
        self.assertEqual(self.check()["status"], "passed")

    def test_every_missing_or_unhealthy_sample_fails(self):
        changes = {
            "missing PG": lambda r: r.pop("pg"),
            "failed PG": lambda r: r["pg"].update(code=1),
            "empty PG output": lambda r: r["pg"].update(out=""),
            "missing role": lambda r: r["pg"].update(out=json.dumps({"roles": json.loads(r["pg"]["out"])["roles"][:2]})),
            "missing container": lambda r: r["containers"].pop("web"),
            "container inspect error": lambda r: r["containers"].update(web={"error": "inspect failed"}),
            "missing cgroup": lambda r: r["containers"]["postgres"]["cgroup"].pop("memory.events"),
            "stopped container": lambda r: r["containers"]["media"]["state"].update(Running=False),
            "OOM counter": lambda r: r["containers"]["postgres"]["cgroup"].update({"memory.events": "oom 1\noom_kill 1"}),
        }
        for name, mutate in changes.items():
            with self.subTest(name=name):
                rows = copy.deepcopy(self.rows)
                mutate(rows[100])
                result = self.check(rows)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["checkedSampleCount"], 177)
                self.assertEqual(result["skippedWithinWindow"], 0)

    def test_recorded_http_readiness_failure_or_gap_is_not_ignored(self):
        rows = copy.deepcopy(self.rows)
        for row in rows:
            row["httpReady"] = {"ok": True, "status": 200}
        self.assertTrue(self.check(rows)["continuousHttpReadinessMeasured"])
        self.assertEqual(self.check(rows)["status"], "passed")
        rows[100]["httpReady"]["ok"] = False
        self.assertEqual(self.check(rows)["status"], "failed")
        rows[100].pop("httpReady")
        self.assertEqual(self.check(rows)["status"], "failed")

    def test_large_gap_is_failure_not_silently_discarded(self):
        self.assertEqual(self.check(self.rows[:100] + self.rows[105:])["status"], "failed")

    def test_bad_sample_after_nominal_window_before_shutdown_is_checked(self):
        rows = copy.deepcopy(self.rows)
        extra = copy.deepcopy(rows[-1]); extra["time"] += 1; extra["pg"]["code"] = 1; rows.append(extra)
        lifecycle = copy.deepcopy(self.lifecycle)
        lifecycle["shutdownRequestedAt"] = self.end + 1
        lifecycle["finalHealth"]["at"] = self.end + 1
        result = self.check(rows, lifecycle=lifecycle)
        self.assertEqual(result["checkedSampleCount"], 178)
        self.assertEqual(result["status"], "failed")

    def test_actual_phase2_tail_failure_prevents_pass(self):
        rows = [json.loads(line) for line in (RAW / "phase2/diagnostic-samples.jsonl").read_text().splitlines()]
        events = verify.read_events([RAW / f"phase2/diagnostic-{role}-live.log" for role in ("web", "media", "control")])
        result = verify.audit(rows, rows[21]["time"], rows[-1]["time"], events=events)
        self.assertEqual(result["windowSampleCount"], 311)
        self.assertTrue(result["windowSampleChecksPassed"])
        self.assertEqual(result["status"], "failed")
        failures = result["applicationFailuresAfterWindowBeforeShutdown"]
        self.assertEqual(sum(e["event"] == "query_error" for e in failures), 3)
        self.assertEqual(sum(e["event"] == "STORAGE_ROLE_LOST" for e in failures), 3)

    def test_missing_or_stale_final_health_and_tail_coverage_prevents_pass(self):
        for field in ("finalHealth", "ready", "applicationLogsCollectedThroughShutdown"):
            with self.subTest(field=field):
                receipt = copy.deepcopy(self.lifecycle); receipt.pop(field)
                self.assertEqual(self.check(lifecycle=receipt)["status"], "incomplete")
        receipt = copy.deepcopy(self.lifecycle); receipt["shutdownRequestedAt"] = self.end + 10
        self.assertEqual(self.check(lifecycle=receipt)["status"], "incomplete")


if __name__ == "__main__":
    unittest.main()
