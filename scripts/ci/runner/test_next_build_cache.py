import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("next_build_cache", Path(__file__).with_name("next-build-cache.py"))
cache_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache_module)


class NextCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.workspace = self.work / "repo" / "repo"
        self.workspace.mkdir(parents=True)
        (self.workspace / "bun.lock").write_text("lock-v1")
        self.cache = cache_module.NextCache(self.workspace, self.work, "node24;bun1")

    def populate(self):
        self.cache.target.mkdir(parents=True, exist_ok=True)
        payload = self.cache.target / "compiler.cache"
        payload.write_text("cached module")
        return payload

    def test_miss_then_save_restore_preserves_inode_and_survives_checkout_cleanup(self):
        self.assertFalse(self.cache.restore())
        payload = self.populate()
        inode = payload.stat().st_ino
        self.assertTrue(self.cache.save())
        self.assertFalse(self.cache.target.exists())
        import shutil
        shutil.rmtree(self.workspace / "apps")
        self.assertTrue(self.cache.restore())
        restored = self.cache.target / "compiler.cache"
        self.assertEqual(restored.stat().st_ino, inode)
        self.assertEqual(restored.read_text(), "cached module")
        self.assertFalse(self.cache.slot.exists())

    def test_lock_runtime_and_workspace_changes_invalidate_cache(self):
        self.populate()
        self.cache.save()
        for runtime in ["node25;bun1", "node24;bun2"]:
            self.assertFalse(cache_module.NextCache(self.workspace, self.work, runtime).restore())
        (self.workspace / "bun.lock").write_text("lock-v2")
        self.assertFalse(cache_module.NextCache(self.workspace, self.work, "node24;bun1").restore())
        other = self.work / "other" / "other"
        other.mkdir(parents=True)
        (other / "bun.lock").write_text("lock-v1")
        self.assertFalse(cache_module.NextCache(other, self.work, "node24;bun1").restore())

    def test_save_missing_cache_is_noop(self):
        self.assertFalse(self.cache.save())

    def test_restore_does_not_overwrite_an_existing_cache(self):
        self.populate()
        self.cache.save()
        self.populate().write_text("existing")
        with self.assertRaises(FileExistsError):
            self.cache.restore()
        self.assertEqual((self.cache.target / "compiler.cache").read_text(), "existing")

    def test_rejects_symlink_cache_root_slot_and_workspace_target(self):
        outside = self.work / "outside"
        outside.mkdir()
        self.cache.root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.cache.restore()
        self.cache.root.unlink()
        self.cache.root.mkdir()
        self.cache.slot.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.cache.restore()
        self.cache.slot.unlink()
        (self.workspace / "apps").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.cache.restore()

    def test_workspace_must_be_nested_in_the_worker_volume(self):
        with self.assertRaises(ValueError):
            cache_module.NextCache(self.work, self.work, "runtime")
        with self.assertRaises(ValueError):
            cache_module.NextCache(self.work.parent, self.work, "runtime")


if __name__ == "__main__":
    unittest.main()
