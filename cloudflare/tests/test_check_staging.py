import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location(
    "check_staging", Path(__file__).parents[1] / "scripts" / "check_staging.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def settings():
    return {"bindings": [
        {"name": "DB", "type": "d1", "id": module.DATABASE},
        {"name": "PLAID_ENV", "type": "plain_text", "text": "sandbox"},
        {"name": "STAGING_TEST_USER_ID", "type": "plain_text", "text": "private-user-id"},
        *[{"name": name, "type": "secret_text", "text": "DO-NOT-LOG"}
          for name in module.REQUIRED_SECRETS],
        {"name": "UNKNOWN_PRIVATE_NAME", "type": "plain_text", "text": "DO-NOT-LOG"},
    ]}


class CheckerTests(unittest.TestCase):
    def test_redacts_values_and_unknown_bindings(self):
        output = json.dumps(module.summarize(settings()))
        for private in ("DO-NOT-LOG", "private-user-id", "UNKNOWN_PRIVATE_NAME", module.DATABASE):
            self.assertNotIn(private, output)

    def test_rejects_production_database(self):
        data = settings()
        data["bindings"][0]["id"] = "production-db"
        with self.assertRaises(module.CheckFailed):
            module.summarize(data)

    def test_rejects_production_plaid_environment(self):
        data = settings()
        data["bindings"][1]["text"] = "production"
        with self.assertRaises(module.CheckFailed):
            module.summarize(data)

    def test_rejects_plaintext_secret(self):
        data = settings()
        next(b for b in data["bindings"] if b["name"] == "PLAID_SECRET")["type"] = "plain_text"
        with self.assertRaises(module.CheckFailed):
            module.summarize(data)

    def test_missing_token_does_not_connect(self):
        with self.assertRaises(module.CheckFailed):
            module.inspect("")

    def test_only_gets_exact_staging_endpoint(self):
        captured = []
        class Opener:
            def open(self, request, timeout):
                captured.append(request)
                return io.StringIO(json.dumps({"success": True, "result": settings()}))
        module.inspect("test-token", Opener())
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].full_url, module.URL)
        self.assertEqual(captured[0].method, "GET")

    def test_http_error_body_is_not_exposed(self):
        class Opener:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(module.URL, 403, "PRIVATE", {}, io.BytesIO(b"PRIVATE"))
        with self.assertRaises(module.CheckFailed) as ctx:
            module.inspect("test-token", Opener())
        self.assertNotIn("PRIVATE", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
