"""Two separate approved operations: upload code, then promote a reviewed version.

Targets are fixed. No routes, secrets, databases or production resources are edited.
API errors deliberately omit raw bodies and binding values.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
import uuid

from check_staging import ACCOUNT, WORKER, CheckFailed, NoRedirect, summarize

BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{WORKER}"
SOURCE = Path(__file__).parents[1] / "staging-worker.mjs"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def reviewed_source_matches(candidate_commit, commit, source):
    if candidate_commit == commit:
        return True
    if not isinstance(candidate_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", candidate_commit):
        return False
    if not source:
        return False
    root = SOURCE.parents[1]
    try:
        subprocess.run(["git", "merge-base", "--is-ancestor", candidate_commit, commit],
                       cwd=root, check=True, capture_output=True, timeout=15)
        previous = subprocess.run(["git", "show", candidate_commit + ":cloudflare/staging-worker.mjs"],
                                  cwd=root, check=True, capture_output=True, timeout=15).stdout
    except (subprocess.SubprocessError, OSError):
        return False
    return previous == source


def version_id(value):
    if not isinstance(value, str) or not UUID.fullmatch(value):
        raise CheckFailed("A full lowercase Cloudflare version UUID is required.")
    return value


class API:
    def __init__(self, token):
        if not token:
            raise CheckFailed("CLOUDFLARE_API_TOKEN environment secret is missing.")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, path, method="GET", data=None, content_type="application/json"):
        if path not in ("/settings", "/versions", "/deployments") and not re.fullmatch(
            r"/versions/[0-9a-f-]{36}", path
        ):
            raise CheckFailed("Unsupported staging API path.")
        if method not in ("GET", "POST") or (
            method == "POST" and path not in ("/versions", "/deployments")
        ):
            raise CheckFailed("Unsupported staging API operation.")
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
        request = urllib.request.Request(BASE + path, method=method, data=data,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": content_type})
        try:
            with self.opener.open(request, timeout=60) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            raise CheckFailed(f"Cloudflare returned HTTP {error.code}; raw body omitted.") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise CheckFailed("Cloudflare request failed. State may be unknown; inspect before retrying.") from None
        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise CheckFailed("Cloudflare did not confirm success; raw response omitted.")
        return payload.get("result")


def active(api):
    result = api.call("/deployments")
    deployments = result.get("deployments", []) if isinstance(result, dict) else []
    if not deployments:
        raise CheckFailed("No staging deployment found.")
    current = max(deployments, key=lambda item: item.get("created_on", ""))
    versions = current.get("versions", [])
    if len(versions) != 1 or versions[0].get("percentage") != 100:
        raise CheckFailed("Staging must have exactly one active version at 100%.")
    return version_id(versions[0].get("version_id"))


def configuration(version):
    resources = version.get("resources", {})
    bindings = resources.get("bindings")
    if isinstance(bindings, dict):
        bindings = [dict(value, name=name) for name, value in bindings.items()]
    if not isinstance(bindings, list):
        raise CheckFailed("Unrecognized version bindings; stop for review.")
    result = {**resources.get("script_runtime", {}), "bindings": bindings}
    summarize(result)
    if any(b.get("type") not in {"plain_text", "secret_text", "d1"} for b in bindings):
        raise CheckFailed("Additional binding types require review before code upload.")
    return result


def fingerprint(settings):
    # Used in memory only. Secret values are neither retrieved nor compared.
    fields = {
        "bindings": sorted(settings["bindings"], key=lambda b: b["name"]),
        "compatibility_date": settings.get("compatibility_date"),
        "compatibility_flags": settings.get("compatibility_flags", []),
        "usage_model": settings.get("usage_model"),
    }
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def multipart(metadata, source):
    boundary = "flowpay-" + uuid.uuid4().hex
    chunks = []
    for name, filename, mime, value in (
        ("metadata", None, "application/json", json.dumps(metadata).encode()),
        ("worker.mjs", "worker.mjs", "application/javascript+module", source),
    ):
        disposition = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{filename}"'
        chunks.append((f"--{boundary}\r\n{disposition}\r\nContent-Type: {mime}\r\n\r\n").encode()
                      + value + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def manage(api, operation, expected_active, candidate="", commit="", source=b""):
    if operation not in {"inspect", "upload", "promote"}:
        raise CheckFailed("Unsupported operation.")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise CheckFailed("Expected a full reviewed Git commit SHA.")
    if operation == "inspect":
        current = active(api)
        settings = configuration(api.call("/versions/" + current))
        return {**summarize(settings), "active_version": current, "changed": False}
    expected_active = version_id(expected_active)
    if active(api) != expected_active:
        raise CheckFailed("Active staging version changed; review again.")
    original = configuration(api.call("/versions/" + expected_active))
    if operation == "upload":
        items = api.call("/versions").get("items", [])
        if not items:
            raise CheckFailed("No uploaded versions found.")
        latest = max(items, key=lambda item: item.get("number", -1))
        if latest.get("id") != expected_active:
            raise CheckFailed("An undeployed version exists. Review it before uploading code.")
        if not source:
            raise CheckFailed("Worker source is empty.")
        if original.get("limits") or original.get("placement") or original.get("cache_options"):
            raise CheckFailed("Additional runtime settings require review before upload.")
        exports = original.get("exports", {})
        if set(exports) - {"default"} or exports.get("default", {}).get("cache"):
            raise CheckFailed("Additional Worker exports or cache settings require review.")
        date = original.get("compatibility_date")
        if not date:
            raise CheckFailed("Missing runtime compatibility date.")
        metadata = {
            "main_module": "worker.mjs",
            "keep_bindings": ["plain_text", "secret_text", "d1"],
            "compatibility_date": date,
            "compatibility_flags": original.get("compatibility_flags", []),
            "annotations": {"workers/message": "FlowPay staging code " + commit,
                            "workers/commit_sha": commit},
        }
        if original.get("usage_model"):
            metadata["usage_model"] = original["usage_model"]
        if active(api) != expected_active:
            raise CheckFailed("Staging changed before upload; stopped.")
        body, content_type = multipart(metadata, source)
        uploaded = api.call("/versions", "POST", body, content_type)
        candidate = version_id(uploaded.get("id"))
        settings = configuration(api.call("/versions/" + candidate))
        if fingerprint(settings) != fingerprint(original):
            raise CheckFailed("Uploaded version settings differ. It remains undeployed; review it.")
        if active(api) != expected_active:
            raise CheckFailed("Active deployment changed during upload; inspect before continuing.")
        return {"uploaded_version": candidate, "deployed": False,
                "commit": commit, "source_sha256": hashlib.sha256(source).hexdigest()}
    candidate = version_id(candidate)
    detail = api.call("/versions/" + candidate)
    settings = configuration(detail)
    annotations = detail.get("annotations", {})
    if not reviewed_source_matches(annotations.get("workers/commit_sha"), commit, source):
        raise CheckFailed("Candidate is not annotated with the selected reviewed commit.")
    if fingerprint(settings) != fingerprint(original):
        raise CheckFailed("Candidate bindings or runtime settings differ from active staging.")
    if active(api) != expected_active:
        raise CheckFailed("Staging changed before promotion; stopped.")
    deployment = api.call("/deployments", "POST", {
        "strategy": "percentage",
        "versions": [{"version_id": candidate, "percentage": 100}],
        "annotations": {"workers/message": "Approved FlowPay staging " + commit},
    })
    if active(api) != candidate:
        raise CheckFailed("Promotion verification failed; inspect staging. No automatic rollback attempted.")
    return {"deployed_version": candidate, "previous_version": expected_active,
            "deployment_id": deployment.get("id"), "traffic_percent": 100}


if __name__ == "__main__":
    try:
        commit = os.environ.get("APPROVED_COMMIT", "")
        if os.environ.get("GITHUB_REF") != "refs/heads/main" or commit != os.environ.get("GITHUB_SHA"):
            raise CheckFailed("Run on main and confirm its exact commit SHA.")
        if os.environ.get("CONFIRMATION") != "flowpay-plaid-api-staging":
            raise CheckFailed("Explicit staging confirmation is required.")
        result = manage(API(os.environ.get("CLOUDFLARE_API_TOKEN", "")),
                        os.environ.get("OPERATION", ""),
                        os.environ.get("EXPECTED_ACTIVE_VERSION", ""),
                        os.environ.get("CANDIDATE_VERSION", ""), commit, SOURCE.read_bytes())
        print(json.dumps(result, indent=2))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as output:
                output.write("### Staging management result\n```json\n" + json.dumps(result, indent=2) + "\n```\n")
    except (CheckFailed, OSError, ValueError, KeyError, TypeError):
        # Print only controlled CheckFailed messages; unexpected values stay private.
        import sys
        error = sys.exception()
        print("Staging operation stopped: " + (str(error) if isinstance(error, CheckFailed)
              else "Unexpected response shape or local I/O failure; raw details omitted."))
        raise SystemExit(1)
