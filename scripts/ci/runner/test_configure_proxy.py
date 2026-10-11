import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("configure_proxy", Path(__file__).with_name("configure-proxy.py"))
configure_proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure_proxy)


class ConfigureProxyTests(unittest.TestCase):
    def test_preserves_registry_auth_and_other_contexts_with_private_file_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / ".docker"
            directory.mkdir()
            target = directory / "config.json"
            original = {"auths": {"registry.example": {"auth": "test-sentinel"}},
                        "credsStore": "example", "proxies": {"another-context": {"httpProxy": "http://example:1234"}}}
            target.write_text(json.dumps(original))
            configure_proxy.configure(directory, "http://172.17.0.1:11092", "localhost,127.0.0.1")
            actual = json.loads(target.read_text())
            self.assertEqual(actual["auths"], original["auths"])
            self.assertEqual(actual["credsStore"], original["credsStore"])
            self.assertEqual(actual["proxies"]["another-context"], original["proxies"]["another-context"])
            self.assertEqual(actual["proxies"]["default"], {"httpProxy": "http://172.17.0.1:11092",
                             "httpsProxy": "http://172.17.0.1:11092", "noProxy": "localhost,127.0.0.1"})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertFalse(list(directory.glob(".proxy-*")))

    def test_no_proxy_does_not_touch_existing_credentials_or_create_a_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / ".docker"
            configure_proxy.configure(directory, "", "")
            self.assertFalse(directory.exists())
            directory.mkdir()
            target = directory / "config.json"
            target.write_text('{"auths":{"registry.example":{"auth":"test-sentinel"}}}')
            original = target.read_bytes()
            configure_proxy.configure(directory, "", "")
            self.assertEqual(target.read_bytes(), original)

    def test_invalid_configuration_is_not_replaced(self):
        for text in ["not json", "[]", '{"proxies":[]}']:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / "config.json"
                target.write_text(text)
                with self.assertRaises(ValueError):
                    configure_proxy.configure(Path(temporary), "http://proxy:11092", "localhost")
                self.assertEqual(target.read_text(), text)
                self.assertFalse(list(Path(temporary).glob(".proxy-*")))

    def test_disabling_managed_proxy_preserves_credentials_and_other_contexts(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = directory / "config.json"
            original = {"auths": {"registry.example": {"auth": "test-sentinel"}},
                        "proxies": {"other": {"httpProxy": "http://other:1234"}}}
            target.write_text(json.dumps(original))
            configure_proxy.configure(directory, "http://proxy:11092", "localhost")
            configure_proxy.configure(directory, "", "localhost")
            self.assertEqual(json.loads(target.read_text()), original)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_disabling_does_not_remove_manually_changed_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = directory / "config.json"
            configure_proxy.configure(directory, "http://proxy:11092", "localhost")
            manual = {"httpProxy": "http://administrator:8080"}
            config = json.loads(target.read_text())
            config["proxies"]["default"] = manual
            target.write_text(json.dumps(config))
            configure_proxy.configure(directory, "", "localhost")
            actual = json.loads(target.read_text())
            self.assertEqual(actual["proxies"]["default"], manual)
            self.assertNotIn(configure_proxy.MANAGED_KEY, actual)


if __name__ == "__main__":
    unittest.main()
