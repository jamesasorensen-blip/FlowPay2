"""Read-only staging connection check; never serialize raw Cloudflare responses."""
import json
import os
import urllib.error
import urllib.request

ACCOUNT = "dfc1099dc7e62edb17beac9a0729ae03"
WORKER = "flowpay-plaid-api-staging"
DATABASE = "c48b67dc-2066-4d82-b357-567541a88548"
URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings"
REQUIRED_SECRETS = {
    "PLAID_CLIENT_ID", "PLAID_SECRET", "SUPABASE_URL", "TOKEN_ENCRYPTION_KEY"
}


class CheckFailed(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def summarize(settings):
    bindings = settings.get("bindings", [])
    by_name = {binding.get("name"): binding for binding in bindings}
    db = by_name.get("DB", {})
    if db.get("type") != "d1" or db.get("id") != DATABASE:
        raise CheckFailed("DB does not match the expected staging D1 database.")
    plaid_env = by_name.get("PLAID_ENV", {})
    if plaid_env.get("type") != "plain_text" or plaid_env.get("text") != "sandbox":
        raise CheckFailed("PLAID_ENV must be a plain-text sandbox setting.")
    for name in REQUIRED_SECRETS:
        if by_name.get(name, {}).get("type") != "secret_text":
            raise CheckFailed(f"Required encrypted binding missing: {name}.")
    uid = by_name.get("STAGING_TEST_USER_ID", {}).get("text", "")
    if not isinstance(uid, str) or not uid.strip():
        raise CheckFailed("Staging test-user restriction is missing.")
    # Only allowlisted names/types are returned; never values, account data or IDs.
    names = sorted(REQUIRED_SECRETS | {"DB", "PLAID_ENV", "STAGING_TEST_USER_ID"})
    return {
        "worker": WORKER,
        "staging_database_matches": True,
        "sandbox_only": True,
        "test_user_restriction_present": True,
        "bindings": [{"name": name, "type": by_name[name]["type"]} for name in names],
    }


def inspect(token, opener=None):
    if not token:
        raise CheckFailed("CLOUDFLARE_API_TOKEN environment secret is missing.")
    request = urllib.request.Request(
        URL, method="GET", headers={"Authorization": "Bearer " + token}
    )
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        # API error bodies can contain sensitive data; report only HTTP status.
        raise CheckFailed(f"Cloudflare returned HTTP {error.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise CheckFailed("Cloudflare request failed; raw response omitted.") from None
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise CheckFailed("Cloudflare did not confirm success; raw response omitted.")
    settings = payload.get("result")
    if not isinstance(settings, dict):
        raise CheckFailed("Unexpected Cloudflare settings response.")
    return summarize(settings)


if __name__ == "__main__":
    try:
        print(json.dumps(inspect(os.environ.get("CLOUDFLARE_API_TOKEN", "")), indent=2))
    except CheckFailed as error:
        print(f"Staging check failed: {error}")
        raise SystemExit(1)
