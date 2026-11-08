import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import manage_staging as manager
from check_staging import DATABASE, REQUIRED_SECRETS, CheckFailed

OLD = "11111111-1111-4111-8111-111111111111"
NEW = "22222222-2222-4222-8222-222222222222"
SHA = "a" * 40


def version():
    return {"id": OLD, "metadata": {"source": "api"}, "annotations": {"workers/commit_sha": SHA},
        "resources": {"script_runtime": {"compatibility_date": "2026-11-07"},
            "bindings": [
                {"name": "DB", "type": "d1", "id": DATABASE},
                {"name": "PLAID_ENV", "type": "plain_text", "text": "sandbox"},
                {"name": "STAGING_TEST_USER_ID", "type": "plain_text", "text": "private-user"},
                *[{"name": name, "type": "secret_text"} for name in REQUIRED_SECRETS]
            ]}}


class FakeAPI:
    def __init__(self):
        self.current = OLD
        self.latest = OLD
        self.versions = {OLD: version(), NEW: version()}
        self.calls = []
        self.changed_after_upload = False

    def call(self, path, method="GET", data=None, content_type="application/json"):
        self.calls.append((path, method, data))
        if method == "POST" and path == "/versions":
            self.latest = NEW
            if self.changed_after_upload:
                self.versions[NEW]["resources"]["bindings"][0]["id"] = "production-db"
            return {"id": NEW}
        if method == "POST" and path == "/deployments":
            self.current = data["versions"][0]["version_id"]
            return {"id": "deployment"}
        if path == "/deployments":
            return {"deployments": [{"created_on": "2026-11-08", "versions": [
                {"version_id": self.current, "percentage": 100}]}]}
        if path == "/versions":
            return {"items": [{"id": self.latest, "number": 2}]}
        if path.startswith("/versions/"):
            return copy.deepcopy(self.versions[path.rsplit("/", 1)[1]])
        raise AssertionError("Unexpected API route")


class ManagementTests(unittest.TestCase):
    def test_inspect_only_reads(self):
        api = FakeAPI()
        result = manager.manage(api, "inspect", "", commit=SHA)
        self.assertEqual(result["active_version"], OLD)
        self.assertFalse(result["changed"])
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_extra_runtime_settings_block_upload(self):
        api = FakeAPI()
        api.versions[OLD]["resources"]["script_runtime"]["limits"] = {"cpu_ms": 50}
        with self.assertRaises(CheckFailed):
            manager.manage(api, "upload", OLD, commit=SHA, source=b"code")
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_upload_never_promotes_and_keeps_bindings(self):
        api = FakeAPI()
        result = manager.manage(api, "upload", OLD, commit=SHA, source=b"export default {};")
        self.assertFalse(result["deployed"])
        self.assertEqual(api.current, OLD)
        self.assertFalse(any(path == "/deployments" and method == "POST"
                             for path, method, data in api.calls))
        body = next(data for path, method, data in api.calls if path == "/versions" and method == "POST")
        self.assertIn(b'"keep_bindings": ["plain_text", "secret_text", "d1"]', body)
        self.assertNotIn(b"private-user", body)

    def test_promote_exact_candidate(self):
        api = FakeAPI()
        result = manager.manage(api, "promote", OLD, NEW, SHA)
        self.assertEqual(result["deployed_version"], NEW)
        self.assertEqual(api.current, NEW)

    def test_missing_annotations_block_all_writes(self):
        api = FakeAPI()
        del api.versions[NEW]["annotations"]
        with self.assertRaises(CheckFailed):
            manager.manage(api, "promote", OLD, NEW, SHA)
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_nested_metadata_annotation_is_not_accepted(self):
        api = FakeAPI()
        api.versions[NEW]["metadata"]["annotations"] = api.versions[NEW].pop("annotations")
        with self.assertRaises(CheckFailed):
            manager.manage(api, "promote", OLD, NEW, SHA)
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_stale_active_version_blocks_writes(self):
        api = FakeAPI()
        with self.assertRaises(CheckFailed):
            manager.manage(api, "upload", NEW, commit=SHA, source=b"code")
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_pending_version_blocks_upload(self):
        api = FakeAPI()
        api.latest = NEW
        with self.assertRaises(CheckFailed):
            manager.manage(api, "upload", OLD, commit=SHA, source=b"code")
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_uploaded_wrong_database_stays_undeployed(self):
        api = FakeAPI()
        api.changed_after_upload = True
        with self.assertRaises(CheckFailed):
            manager.manage(api, "upload", OLD, commit=SHA, source=b"code")
        self.assertEqual(api.current, OLD)

    def test_changed_test_user_blocks_promotion(self):
        api = FakeAPI()
        api.versions[NEW]["resources"]["bindings"][2]["text"] = "different-user"
        with self.assertRaises(CheckFailed):
            manager.manage(api, "promote", OLD, NEW, SHA)
        self.assertEqual(api.current, OLD)

    def test_wrong_commit_blocks_promotion(self):
        api = FakeAPI()
        with self.assertRaises(CheckFailed):
            manager.manage(api, "promote", OLD, NEW, "b" * 40)
        self.assertEqual(api.current, OLD)

    def test_binding_type_change_blocks_promotion(self):
        api = FakeAPI()
        api.versions[NEW]["resources"]["bindings"][3]["type"] = "plain_text"
        with self.assertRaises(CheckFailed):
            manager.manage(api, "promote", OLD, NEW, SHA)
        self.assertEqual(api.current, OLD)

    def test_version_cannot_inject_path(self):
        with self.assertRaises(CheckFailed):
            manager.version_id("../production")

    def test_unsupported_api_operation_is_rejected_locally(self):
        api = manager.API("fake")
        with self.assertRaises(CheckFailed):
            api.call("/secrets", "POST", {})
        with self.assertRaises(CheckFailed):
            api.call("/settings", "PATCH", {})


if __name__ == "__main__":
    unittest.main()
