import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("manager", Path(__file__).with_name("manager.py"))
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class ManagerTests(unittest.TestCase):
    def test_repository_validation(self):
        for value in ["../repo", "https://github.com/a/b", "a/b;id", "a/b'", "a/b/c", "a/.."]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                manager.repository_key(value)

    def test_keys_do_not_collide_and_fit_runner_names(self):
        self.assertNotEqual(manager.repository_key("a/b-c"), manager.repository_key("a-b/c"))
        self.assertNotEqual(manager.repository_key("a/b_c"), manager.repository_key("a/b.c"))
        self.assertEqual(manager.repository_key("OWNER/REPO"), manager.repository_key("owner/repo"))
        self.assertLessEqual(len("localhost-128-" + manager.instance_key("a" * 39 + "/" + "b" * 100, "01")), 64)

    def test_instance_validation(self):
        for value in ["../x", "foo bar", "x;id", "", "A"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                manager.instance_key("owner/repo", value)

    def test_private_daemon_shared_workspace_and_no_host_secrets(self):
        config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"))
        runner = config["services"]["runner"]
        daemon = config["services"]["docker"]
        self.assertEqual(runner["network_mode"], "service:docker")
        self.assertIn("work:/opt/actions-runner/_work", runner["volumes"])
        self.assertIn("work:/opt/actions-runner/_work", daemon["volumes"])
        self.assertNotIn("ports", daemon)
        self.assertNotIn("privileged", runner)
        self.assertNotIn("/var/run/docker.sock", str(runner["volumes"]))
        self.assertNotIn("/home/i", str(runner["volumes"]))
        self.assertEqual(runner["mem_limit"], "8g")
        self.assertEqual(runner["cpus"], 32)
        self.assertEqual(runner["security_opt"], ["no-new-privileges:true"])
        self.assertEqual(daemon["mem_limit"], "4g")
        self.assertEqual(daemon["cpus"], 16)
        self.assertNotIn("token", str(config).lower())


if __name__ == "__main__":
    unittest.main()
