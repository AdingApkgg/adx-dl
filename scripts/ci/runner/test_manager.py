import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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
        export_hook = str(manager.ROOT / "runner" / "next-export-links.cjs") + ":/etc/gha-runner/next-export-links.cjs:ro"
        # Only this public CI helper may be mounted from the manager directory;
        # never admit a host home directory, SSH files or other private paths.
        for mount in runner["volumes"]:
            if mount.startswith("/home/i"):
                self.assertEqual(mount, export_hook)
        self.assertEqual(runner["mem_limit"], "8g")
        self.assertEqual(runner["cpus"], 32)
        self.assertEqual(runner["security_opt"], ["no-new-privileges:true"])
        self.assertIn(str(manager.ROOT / "runner" / "next-export-links.cjs") + ":/etc/gha-runner/next-export-links.cjs:ro", runner["volumes"])
        self.assertEqual(daemon["mem_limit"], "4g")
        self.assertEqual(daemon["cpus"], 16)
        self.assertNotIn("token", str(config).lower())

    def test_daemon_can_mount_runner_externals_and_tool_cache_with_workspace_writable(self):
        config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"))
        runner = config["services"]["runner"]
        daemon = config["services"]["docker"]
        self.assertIn("state:/opt/actions-runner:ro", daemon["volumes"])
        self.assertIn("tools:/opt/hostedtoolcache", daemon["volumes"])
        self.assertIn("tools:/opt/hostedtoolcache", runner["volumes"])
        self.assertIn("work:/opt/actions-runner/_work", daemon["volumes"])
        self.assertNotIn("work:/opt/actions-runner/_work:ro", daemon["volumes"])

    def test_new_volumes_are_seeded_from_runner_image_before_daemon_starts(self):
        config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"))
        self.assertIn("init-volumes", config["services"])
        initializer = config["services"]["init-volumes"]
        self.assertEqual(initializer["image"], config["services"]["runner"]["image"])
        self.assertEqual(initializer["network_mode"], "none")
        self.assertEqual(initializer["entrypoint"], ["/usr/bin/python3", "-I", "/etc/gha-runner/configure-proxy.py"])
        self.assertEqual(initializer["volumes"], ["state:/opt/actions-runner", "work:/opt/actions-runner/_work", "tools:/opt/hostedtoolcache",
                         str(manager.ROOT / "runner" / "configure-proxy.py") + ":/etc/gha-runner/configure-proxy.py:ro"])
        self.assertEqual(config["services"]["docker"]["depends_on"],
                         {"init-volumes": {"condition": "service_completed_successfully"}})
        self.assertEqual(config["services"]["runner"]["depends_on"],
                         {"docker": {"condition": "service_healthy"}})

    def test_private_daemon_address_pools_avoid_host_bridge(self):
        config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"))
        command = config["services"]["docker"]["command"]
        self.assertIn("--bip=10.240.0.1/24", command)
        self.assertIn("--default-address-pool=base=10.241.0.0/16,size=24", command)

    def test_optional_network_settings_and_proxy_environment(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            self.assertNotIn("proxy_url", manager.load_network_config())
            config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"))
            for service in ["runner", "docker"]:
                environment = config["services"][service]["environment"]
                self.assertNotIn("HTTP_PROXY", environment)
                self.assertNotIn("https_proxy", environment)
                self.assertEqual(environment["NO_PROXY"], manager.DEFAULT_NO_PROXY)
                self.assertEqual(environment["no_proxy"], manager.DEFAULT_NO_PROXY)
            settings = {"proxy_url": "http://172.17.0.1:11092", "no_proxy": "localhost,127.0.0.1,.example.test"}
            (manager.ROOT / "network.json").write_text(json.dumps(settings))
            self.assertEqual(manager.load_network_config(), settings)
            config = manager.compose_config("AdingApkgg/adx-dl", "01", "astrodx-ci", 32, "8g", Path("/manager/policy.json"), settings)
            for service in ["runner", "docker"]:
                environment = config["services"][service]["environment"]
                for variable in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]:
                    self.assertEqual(environment[variable], settings["proxy_url"])
                for variable in ["NO_PROXY", "no_proxy"]:
                    self.assertEqual(environment[variable], settings["no_proxy"])

    def test_initializer_always_reconciles_cli_proxy_using_readonly_script_and_shared_state(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            without_proxy = manager.compose_config("a/b", "01", "b-ci", 2, "1g", Path("/policy.json"))
            initializer = without_proxy["services"]["init-volumes"]
            self.assertEqual(initializer["entrypoint"], ["/usr/bin/python3", "-I", "/etc/gha-runner/configure-proxy.py"])
            self.assertIn(str(manager.ROOT / "runner" / "configure-proxy.py") + ":/etc/gha-runner/configure-proxy.py:ro", initializer["volumes"])
            self.assertEqual(initializer["environment"]["DOCKER_CONFIG"], "/opt/actions-runner/.docker")
            self.assertEqual(initializer["environment"]["NO_PROXY"], manager.DEFAULT_NO_PROXY)
            self.assertEqual(initializer["environment"]["no_proxy"], manager.DEFAULT_NO_PROXY)
            for variable in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]:
                self.assertNotIn(variable, initializer["environment"])
            self.assertEqual(without_proxy["services"]["runner"]["environment"]["DOCKER_CONFIG"], "/opt/actions-runner/.docker")
            with_proxy = manager.compose_config("a/b", "01", "b-ci", 2, "1g", Path("/policy.json"), {"proxy_url": "http://172.17.0.1:11092"})
            initializer = with_proxy["services"]["init-volumes"]
            self.assertEqual(initializer["entrypoint"], ["/usr/bin/python3", "-I", "/etc/gha-runner/configure-proxy.py"])
            self.assertIn(str(manager.ROOT / "runner" / "configure-proxy.py") + ":/etc/gha-runner/configure-proxy.py:ro", initializer["volumes"])
            self.assertIn("state:/opt/actions-runner", initializer["volumes"])
            self.assertEqual(initializer["environment"]["DOCKER_CONFIG"], "/opt/actions-runner/.docker")
            self.assertEqual(initializer["environment"]["HTTPS_PROXY"], "http://172.17.0.1:11092")
            self.assertEqual(with_proxy["services"]["runner"]["environment"]["DOCKER_CONFIG"], "/opt/actions-runner/.docker")
            self.assertNotIn("DOCKER_CONFIG", with_proxy["services"]["docker"]["environment"])
            self.assertEqual(with_proxy["services"]["docker"]["depends_on"], {"init-volumes": {"condition": "service_completed_successfully"}})

    def test_proxy_url_rejects_credentials_paths_and_invalid_authorities(self):
        for proxy in ["http://proxy.example:3128", "https://proxy.example", "http://[::1]:3128"]:
            with self.subTest(proxy=proxy):
                config = manager.compose_config("a/b", "01", "b-ci", 2, "1g", Path("/policy.json"), {"proxy_url": proxy})
                self.assertEqual(config["services"]["runner"]["environment"]["HTTP_PROXY"], proxy)
        invalid = ["http://user:secret@host:3128", "http://user@host", "http://host/", "http://host/path",
                   "http://host?query", "http://host#fragment", "socks5://host:1080", "http://", "http://bad host:3128",
                   "http://host:0", "http://host:65536", "http://host:", "http://host:no", "http://-host:3128", "http://host..:3128",
                   "http://999.1.1.1:3128", "http://[bad]:3128", "http://host\n:3128", "", None]
        for proxy in invalid:
            with self.subTest(proxy=proxy), self.assertRaises(ValueError):
                manager.compose_config("a/b", "01", "b-ci", 2, "1g", Path("/policy.json"), {"proxy_url": proxy})

    def test_network_file_rejects_malformed_or_unsupported_settings(self):
        invalid = ["{", "[]", "null", '{"password": "secret"}', '{"proxy_url": 123}', '{"no_proxy": []}',
                   '{"no_proxy": "localhost\\nhttp://user:secret@host"}', '{"no_proxy": "$SECRET"}']
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            for content in invalid:
                with self.subTest(content=content), self.assertRaises(ValueError):
                    (manager.ROOT / "network.json").write_text(content)
                    manager.load_network_config()

    def test_shared_network_changes_refresh_existing_instance_without_changing_manifest(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            directory, manifest = self.make_instance(manager.ROOT)
            self.assertTrue(manager.refresh_compose(directory))
            self.assertFalse(manager.refresh_compose(directory))
            (manager.ROOT / "network.json").write_text('{"proxy_url": "http://172.17.0.1:11092"}')
            self.assertTrue(manager.refresh_compose(directory))
            config = json.loads((directory / "compose.json").read_text())
            self.assertEqual(config["services"]["runner"]["environment"]["HTTP_PROXY"], "http://172.17.0.1:11092")
            self.assertEqual(config["services"]["docker"]["environment"]["HTTPS_PROXY"], "http://172.17.0.1:11092")
            self.assertEqual(config["services"]["runner"]["environment"]["NO_PROXY"], manager.DEFAULT_NO_PROXY)
            self.assertEqual(json.loads((directory / "manifest.json").read_text()), manifest)
            self.assertFalse(manager.refresh_compose(directory))
            (manager.ROOT / "network.json").unlink()
            self.assertTrue(manager.refresh_compose(directory))
            initializer = json.loads((directory / "compose.json").read_text())["services"]["init-volumes"]
            self.assertEqual(initializer["entrypoint"], ["/usr/bin/python3", "-I", "/etc/gha-runner/configure-proxy.py"])
            self.assertNotIn("HTTP_PROXY", initializer["environment"])
            self.assertEqual(initializer["environment"]["DOCKER_CONFIG"], "/opt/actions-runner/.docker")
            self.assertFalse(manager.refresh_compose(directory))

    def test_new_add_reads_shared_network_settings_without_persisting_token(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            (manager.ROOT / "network.json").write_text('{"proxy_url": "http://172.17.0.1:11092"}')
            payload = {"repository": "AdingApkgg/adx-dl", "repository_id": 1267897301,
                       "owner_id": 119665355, "token": "never-persist-this-registration-token"}
            calls = []
            with patch.object(manager, "run_compose", lambda directory, *arguments, **kwargs: calls.append((directory, arguments, kwargs))), \
                 patch("sys.argv", ["runnerctl", "add", payload["repository"]]), patch("sys.stdin", io.StringIO(json.dumps(payload))):
                manager.main()
            directory = manager.ROOT / "instances" / manager.instance_key(payload["repository"], "01")
            config = json.loads((directory / "compose.json").read_text())
            self.assertEqual(config["services"]["runner"]["environment"]["HTTP_PROXY"], "http://172.17.0.1:11092")
            self.assertEqual(calls[0][1], ("up", "-d", "--wait", "docker"))
            self.assertEqual(calls[1][2]["input"], payload["token"] + "\n")
            self.assertNotIn(payload["token"], "".join(path.read_text() for path in directory.glob("*.json")))

    def make_instance(self, root):
        # The existing five-field manifest must remain sufficient. Start/add
        # CLI defaults must not reset its custom identity or resource limits.
        manifest = {"repository": "AdingApkgg/adx-dl", "instance": "custom",
                    "label": "custom-ci", "cpus": 12, "memory": "6g"}
        directory = root / "instances" / manager.instance_key(manifest["repository"], manifest["instance"])
        directory.mkdir(parents=True)
        (directory / "manifest.json").write_text(json.dumps(manifest))
        (directory / "policy.json").write_text('{"unchanged_policy": true}')
        (directory / "compose.json").write_text('{"legacy_configuration": true}')
        return directory, manifest

    def test_refresh_updates_legacy_compose_preserves_manifest_and_reports_changes(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(manager, "ROOT", Path(temporary)):
            directory, manifest = self.make_instance(Path(temporary))
            manifest_text = (directory / "manifest.json").read_text()
            policy_text = (directory / "policy.json").read_text()
            self.assertTrue(manager.refresh_compose(directory))
            config = json.loads((directory / "compose.json").read_text())
            runner, daemon = config["services"]["runner"], config["services"]["docker"]
            self.assertEqual(config["name"], "gha-" + manager.instance_key("AdingApkgg/adx-dl", "custom"))
            self.assertEqual(runner["environment"]["MANAGED_REPOSITORY"], "AdingApkgg/adx-dl")
            self.assertEqual(runner["environment"]["MANAGED_RUNNER_LABELS"], "managed-ci,custom-ci")
            self.assertEqual(runner["cpus"], 12)
            self.assertEqual(runner["mem_limit"], "6g")
            self.assertIn(str(directory / "policy.json") + ":/etc/gha-runner/policy.json:ro", runner["volumes"])
            self.assertIn("state:/opt/actions-runner:ro", daemon["volumes"])
            self.assertEqual(json.loads((directory / "manifest.json").read_text()), manifest)
            self.assertEqual((directory / "manifest.json").read_text(), manifest_text)
            self.assertEqual((directory / "policy.json").read_text(), policy_text)
            compose_text = (directory / "compose.json").read_text()
            modified = (directory / "compose.json").stat().st_mtime_ns
            self.assertFalse(manager.refresh_compose(directory))
            self.assertEqual((directory / "compose.json").read_text(), compose_text)
            self.assertEqual((directory / "compose.json").stat().st_mtime_ns, modified)

    def test_start_and_existing_add_recreate_both_services_only_on_config_change(self):
        for command in ["start", "add"]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                directory, manifest = self.make_instance(root)
                argv = ["runnerctl", command, manifest["repository"], "--instance", "custom",
                        "--label", "ignored-new-label", "--cpus", "99", "--memory", "20g"]
                payload = json.dumps({"repository": manifest["repository"], "token": "must-not-be-persisted"})
                calls = []
                def compose_stub(directory, *arguments, **kwargs):
                    # Capture the external Docker boundary only; refresh and
                    # filesystem effects remain the real production behavior.
                    calls.append((directory, arguments, kwargs))
                with patch.object(manager, "ROOT", root), patch.object(manager, "run_compose", compose_stub), \
                     patch("sys.argv", argv), patch("sys.stdin", io.StringIO(payload)):
                    manager.main()
                self.assertEqual(calls[0][1], ("up", "-d", "--wait", "--force-recreate"))
                self.assertEqual(calls[0][2], {})
                config = json.loads((directory / "compose.json").read_text())
                self.assertEqual(config["services"]["runner"]["cpus"], 12)
                self.assertEqual(config["services"]["runner"]["mem_limit"], "6g")
                self.assertEqual(config["services"]["runner"]["environment"]["MANAGED_RUNNER_LABELS"], "managed-ci,custom-ci")
                self.assertNotIn("must-not-be-persisted", "".join(path.read_text() for path in directory.glob("*.json")))
                calls.clear()
                with patch.object(manager, "ROOT", root), patch.object(manager, "run_compose", compose_stub), \
                     patch("sys.argv", argv), patch("sys.stdin", io.StringIO(payload)):
                    manager.main()
                self.assertEqual(calls[0][1], ("up", "-d", "--wait"))

    def test_stop_and_restart_leave_existing_compose_untouched(self):
        for command in ["stop", "restart"]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                directory, manifest = self.make_instance(root)
                old_config = (directory / "compose.json").read_text()
                argv = ["runnerctl", command, manifest["repository"], "--instance", "custom"]
                with patch.object(manager, "ROOT", root), patch.object(manager, "run_compose"), \
                     patch("sys.argv", argv):
                    manager.main()
                self.assertEqual((directory / "compose.json").read_text(), old_config)


if __name__ == "__main__":
    unittest.main()
