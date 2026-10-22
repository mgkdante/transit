"""Offline runtime trust and loopback TLS verification; never alters host trust."""

import argparse
import hashlib
import inspect
import json
import os
import socket
import ssl
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import botocore
import certifi
import httpx
from botocore.awsrequest import AWSRequest
from botocore.httpsession import URLLib3Session, get_cert_path
from urllib3.util.ssl_match_hostname import CertificateError


class VerificationFailure(RuntimeError):
    def __init__(self, stage):
        self.stage = stage
        super().__init__(stage)


def context_report(context, delegated=False):
    certificates = context.get_ca_certs()
    names = {
        value
        for cert in certificates
        for rdn in cert["subject"]
        for key, value in rdn
        if key == "commonName"
    }
    if "emSign ECC Root CA - G3" in names or "ISRG Root X1" not in names:
        raise RuntimeError("public root policy failed")
    if context.verify_mode != ssl.CERT_REQUIRED or (not delegated and not context.check_hostname):
        raise RuntimeError("certificate verification disabled")
    roots = sorted(
        hashlib.sha256(cert).hexdigest() for cert in context.get_ca_certs(binary_form=True)
    )
    return {
        "roots": len(roots),
        "sha256": hashlib.sha256("".join(roots).encode()).hexdigest(),
        "check_hostname": context.check_hostname,
        "cert_required": True,
        "hostname_verification": "urllib3" if delegated else "SSLContext",
    }


def certificate_failure(error, *, hostname=False):
    """Distinguish trust-chain failures from hostname failures and refused sockets."""
    seen = set()
    pending = [error]
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, CertificateError) and hostname:
            return True
        if isinstance(current, ssl.SSLCertVerificationError):
            # OpenSSL's hostname/IP mismatch codes differ from untrusted-chain codes.
            expected = (62, 64) if hostname else (18, 19, 20, 21)
            if current.verify_code in expected:
                return True
        pending.extend(
            value
            for value in (
                current.__cause__,
                current.__context__,
                getattr(current, "reason", None),
                *getattr(current, "args", ()),
                getattr(current, "kwargs", {}).get("error"),
            )
            if isinstance(value, BaseException)
        )
    return False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_args):
        pass


def make_fixture(directory):
    def openssl(*args):
        subprocess.run(
            ["openssl", *args],
            cwd=directory,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )

    openssl(
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=Transit ephemeral test CA",
        "-keyout",
        "ca.key",
        "-out",
        "ca.pem",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
    )
    openssl(
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=localhost",
        "-keyout",
        "server.key",
        "-out",
        "server.csr",
    )
    (directory / "extensions").write_text(
        "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n"
    )
    openssl(
        "x509",
        "-req",
        "-in",
        "server.csr",
        "-CA",
        "ca.pem",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-days",
        "1",
        "-extfile",
        "extensions",
        "-out",
        "server.pem",
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(directory / "server.pem", directory / "server.key")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    try:
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
    except Exception:
        server.server_close()
        raise
    return server, thread


def request(client, url, ca):
    if client == "urllib":
        context = ssl.create_default_context(cafile=ca)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context)
        )
        with opener.open(url, timeout=3) as response:
            return response.read()
    if client == "httpx":
        with httpx.Client(
            verify=ssl.create_default_context(cafile=ca) if ca else True,
            trust_env=False,
            timeout=3,
        ) as session:
            response = session.get(url)
            response.raise_for_status()
            return response.content
    session = URLLib3Session(verify=ca or True, proxies={}, timeout=3)
    try:
        response = session.send(AWSRequest(method="GET", url=url).prepare())
        if response.status_code != 200:
            raise RuntimeError("unexpected fixture response")
        return response.content
    finally:
        session.close()


def verify_transports(directory, contexts):
    server, thread = make_fixture(directory)
    try:
        port = server.server_address[1]
        results = {}
        for client in ("urllib", "httpx", "botocore"):
            outcomes = {}
            for case, host, ca in (
                ("trusted", "localhost", str(directory / "ca.pem")),
                ("unknown_ca", "localhost", None),
                ("wrong_hostname", "127.0.0.1", str(directory / "ca.pem")),
            ):
                try:
                    body = request(client, f"https://{host}:{port}/", ca)
                except Exception as error:
                    if case == "trusted" or not certificate_failure(
                        error, hostname=case == "wrong_hostname"
                    ):
                        raise VerificationFailure(f"transport:{client}:{case}") from error
                    outcomes[case] = (
                        "hostname_rejected" if case == "wrong_hostname" else "certificate_rejected"
                    )
                else:
                    if case != "trusted" or body != b"ok":
                        raise VerificationFailure(f"transport:{client}:{case}")
                    outcomes[case] = "accepted"
            results[client] = outcomes
        # Each audited public bundle must reject the ephemeral CA on a real TLS connection.
        for name, context in contexts.items():
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
                    with context.wrap_socket(connection, server_hostname="localhost"):
                        raise RuntimeError(f"{name}: unexpected ephemeral CA trust")
            except ssl.SSLCertVerificationError as error:
                if not certificate_failure(error):
                    raise RuntimeError(f"{name}: no unknown-CA rejection proof") from error
            except Exception as error:
                raise VerificationFailure(f"context_handshake:{name}") from error
        return results, server.socket.context.minimum_version.name
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap-python")
    parser.add_argument("--synthetic-only", action="store_true")
    args = parser.parse_args()
    if args.synthetic_only and args.bootstrap_python:
        parser.error("--synthetic-only cannot be combined with --bootstrap-python")
    overrides = [
        name
        for name in ("SSL_CERT_FILE", "SSL_CERT_DIR", "AWS_CA_BUNDLE", "REQUESTS_CA_BUNDLE")
        if os.environ.get(name)
    ]
    if overrides:
        print(
            json.dumps(
                {"ok": False, "error": "CA overrides", "names": overrides, "stage": "environment"}
            )
        )
        return 1
    stage = "configuration"
    try:
        contexts = {}
        reports = {}
        versions = {
            "openssl": ssl.OPENSSL_VERSION,
            "certifi": certifi.__version__,
            "httpx": httpx.__version__,
            "botocore": botocore.__version__,
        }
        if not args.synthetic_only:
            if not args.bootstrap_python:
                raise RuntimeError("--bootstrap-python is required for full verification")
            stage = "bootstrap"
            # App venv deliberately has no pip. Resolve its public bundle with bootstrap Python.
            bootstrap = subprocess.run(
                [
                    args.bootstrap_python,
                    "-B",
                    "-c",
                    "import hashlib,json,ssl,pip\nfrom pip._vendor import certifi\n"
                    + inspect.getsource(context_report)
                    + "\nprint(json.dumps(dict(bundle=certifi.where(),pip=pip.__version__,"
                    "certifi=certifi.__version__,openssl=ssl.OPENSSL_VERSION,"
                    "system_context=context_report(ssl.create_default_context()),"
                    "pip_context=context_report(ssl.create_default_context("
                    "cafile=certifi.where())))))",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            info = json.loads(bootstrap.stdout)
            versions["bootstrap"] = {key: value for key, value in info.items() if key != "bundle"}
            for name, bundle in (
                ("system", None),
                ("certifi", certifi.where()),
                ("pip_vendor", info["bundle"]),
            ):
                stage = f"appcontext:{name}"
                contexts[name] = ssl.create_default_context(cafile=bundle)
                reports[name] = context_report(contexts[name])
            # Pinned-client private getters inspect their contexts only; actual transport
            # handshakes below prove the clients' effective hostname policy.
            stage = "appcontext:httpx"
            with httpx.Client(trust_env=False) as client:
                contexts["httpx"] = client._transport._pool._ssl_context
                reports["httpx"] = context_report(contexts["httpx"])
            stage = "appcontext:botocore"
            session = URLLib3Session(proxies={})
            try:
                context = session._manager.connection_pool_kw["ssl_context"]
                context.load_verify_locations(cafile=get_cert_path(True))
                contexts["botocore"] = context
                reports["botocore"] = context_report(context, delegated=True)
            finally:
                session.close()
        stage = "fixture"
        with tempfile.TemporaryDirectory(prefix="transit-tls-") as directory:
            transports, minimum_tls = verify_transports(Path(directory), contexts)
        print(
            json.dumps(
                {
                    "ok": True,
                    "public_trust_checked": not args.synthetic_only,
                    "fixture_minimum_tls": minimum_tls,
                    "versions": versions,
                    "contexts": reports,
                    "transports": transports,
                    "limits": "Synthetic CA and hostname checks; no compromised-CA-signed "
                    "chain, production endpoint, or ARM64 proof.",
                },
                sort_keys=True,
            )
        )
        return 0
    except Exception as error:
        # Exception text may include paths or environment data; emit only safe failure classes.
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": type(error).__name__,
                    "stage": error.stage if isinstance(error, VerificationFailure) else stage,
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
