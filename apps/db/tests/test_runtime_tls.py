"""Exercise the verifier through its CLI, including real loopback TLS handshakes."""

import json
import os
import runpy
import shutil
import ssl
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "verify-runtime-tls.py"


@pytest.mark.parametrize(
    ("failure", "trust", "hostname"),
    [
        (20, True, False),
        (62, False, True),
        (64, False, True),
        (10, False, False),
        ("urllib3-hostname", False, True),
        ("connection", False, False),
        ("generic-tls", False, False),
    ],
)
def test_rejection_evidence_distinguishes_trust_hostname_and_transport_errors(
    failure, trust, hostname
):
    verifier = runpy.run_path(str(SCRIPT))
    if isinstance(failure, int):
        error = ssl.SSLCertVerificationError(1, "controlled certificate failure")
        error.verify_code = failure
    elif failure == "urllib3-hostname":
        error = verifier["CertificateError"]("controlled hostname mismatch")
    elif failure == "connection":
        error = ConnectionRefusedError("controlled refused socket")
    else:
        error = ssl.SSLError("controlled generic TLS failure")
    assert verifier["certificate_failure"](error) is trust
    assert verifier["certificate_failure"](error, hostname=True) is hostname


def run_probe(*args, env=None):
    return subprocess.run(
        [sys.executable, "-B", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


@pytest.mark.parametrize(
    "name", ["SSL_CERT_FILE", "SSL_CERT_DIR", "AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE"]
)
def test_cli_fails_closed_on_ca_override_without_disclosing_value(name):
    env = os.environ | {name: "private-value-must-not-appear"}
    result = run_probe("--synthetic-only", env=env)
    assert result.returncode == 1
    assert name in result.stdout
    assert json.loads(result.stdout)["stage"] == "environment"
    assert "private-value-must-not-appear" not in result.stdout + result.stderr


def test_cli_exercises_real_client_tls_and_hostname_rejection():
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("SSL_CERT_FILE", "SSL_CERT_DIR", "AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE")
    }
    openssl = shutil.which("openssl")
    if openssl is None and os.name == "nt":
        git = subprocess.run(
            ["git", "--exec-path"], capture_output=True, text=True, check=True, timeout=10
        )
        for parent in Path(git.stdout.strip()).parents:
            candidate = parent / "usr" / "bin" / "openssl.exe"
            if candidate.is_file():
                openssl = str(candidate)
                break
    assert openssl is not None, "Real TLS verification requires existing OpenSSL"
    env["PATH"] = str(Path(openssl).parent) + os.pathsep + env["PATH"]
    result = run_probe("--synthetic-only", env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["ok"] is True
    assert report["public_trust_checked"] is False
    assert report["fixture_minimum_tls"] in ("TLSv1_2", "TLSv1_3")
    for client in ("urllib", "httpx", "botocore"):
        assert report["transports"][client] == {
            "trusted": "accepted",
            "unknown_ca": "certificate_rejected",
            "wrong_hostname": "hostname_rejected",
        }


def test_cli_cannot_claim_full_acceptance_without_bootstrap_python():
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in ("SSL_CERT_FILE", "SSL_CERT_DIR", "AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE")
    }
    result = run_probe(env=env)
    assert result.returncode == 1
    assert json.loads(result.stdout)["ok"] is False
    assert json.loads(result.stdout)["stage"] == "configuration"


def test_cli_fails_when_real_fixture_cannot_be_created(tmp_path):
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in ("SSL_CERT_FILE", "SSL_CERT_DIR", "AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE")
    }
    env["PATH"] = str(tmp_path)
    result = run_probe("--synthetic-only", env=env)
    assert result.returncode == 1
    assert json.loads(result.stdout) == {
        "ok": False,
        "error": "FileNotFoundError",
        "stage": "fixture",
    }


def test_cli_rejects_partial_check_combined_with_full_mode_bootstrap():
    result = run_probe("--synthetic-only", "--bootstrap-python", sys.executable)
    assert result.returncode != 0
    assert "cannot be combined" in result.stderr
