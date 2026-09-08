from __future__ import annotations

import os
import subprocess
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / ".github/scripts/install-gitleaks.sh"


def _write_executable(path: Path, body: str) -> None:
    path.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")
    path.chmod(0o755)


def _fake_tools(tmp_path: Path) -> tuple[Path, Path]:
    tools = tmp_path / "tools"
    tools.mkdir()
    log = tmp_path / "tool.log"

    _write_executable(
        tools / "uname",
        """
        #!/usr/bin/env bash
        printf '%s\n' "${FAKE_ARCH:-x86_64}"
        """,
    )
    _write_executable(
        tools / "curl",
        """
        #!/usr/bin/env bash
        set -euo pipefail
        printf 'curl\n' >> "${TOOL_LOG}"
        output=''
        while [ "$#" -gt 0 ]; do
          if [ "$1" = '-o' ]; then
            output="$2"
            break
          fi
          shift
        done
        test -n "${output}"
        printf 'fake archive\n' > "${output}"
        """,
    )
    _write_executable(
        tools / "sha256sum",
        """
        #!/usr/bin/env bash
        set -euo pipefail
        printf 'sha256sum\n' >> "${TOOL_LOG}"
        read -r _expected
        test "${FAKE_CHECKSUM_FAILURE:-0}" = '0'
        """,
    )
    _write_executable(
        tools / "tar",
        """
        #!/usr/bin/env bash
        set -euo pipefail
        printf 'tar\n' >> "${TOOL_LOG}"
        destination=''
        while [ "$#" -gt 0 ]; do
          if [ "$1" = '-C' ]; then
            destination="$2"
            break
          fi
          shift
        done
        test -n "${destination}"
        printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' \
          "${FAKE_GITLEAKS_VERSION:-8.30.1}" > "${destination}/gitleaks"
        chmod 0755 "${destination}/gitleaks"
        """,
    )
    return tools, log


def _run_installer(
    tmp_path: Path,
    *,
    arch: str = "x86_64",
    checksum_failure: bool = False,
    reported_version: str = "8.30.1",
) -> subprocess.CompletedProcess[str]:
    tools, log = _fake_tools(tmp_path)
    env = {
        **os.environ,
        "PATH": f"{tools}:{os.environ['PATH']}",
        "TMPDIR": str(tmp_path),
        "TOOL_LOG": str(log),
        "FAKE_ARCH": arch,
        "FAKE_CHECKSUM_FAILURE": "1" if checksum_failure else "0",
        "FAKE_GITLEAKS_VERSION": reported_version,
    }
    return subprocess.run(
        ["bash", str(SCRIPT), str(tmp_path / "installed")],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_installer_verifies_before_extracting_and_reports_local_binary(tmp_path: Path) -> None:
    result = _run_installer(tmp_path)

    installed = tmp_path / "installed/gitleaks"
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(installed)
    assert installed.is_file()
    assert installed.stat().st_mode & 0o777 == 0o755
    assert subprocess.check_output([installed, "version"], text=True).strip() == "8.30.1"
    assert (tmp_path / "tool.log").read_text(encoding="utf-8").splitlines() == [
        "curl",
        "sha256sum",
        "tar",
    ]


def test_installer_stops_before_extracting_when_checksum_fails(tmp_path: Path) -> None:
    result = _run_installer(tmp_path, checksum_failure=True)

    assert result.returncode != 0
    assert not (tmp_path / "installed/gitleaks").exists()
    assert (tmp_path / "tool.log").read_text(encoding="utf-8").splitlines() == [
        "curl",
        "sha256sum",
    ]


def test_installer_rejects_unsupported_architecture_before_download(tmp_path: Path) -> None:
    result = _run_installer(tmp_path, arch="aarch64")

    assert result.returncode != 0
    assert "unsupported architecture" in result.stderr
    assert not (tmp_path / "tool.log").exists()


def test_installer_rejects_wrong_binary_version_before_install(tmp_path: Path) -> None:
    result = _run_installer(tmp_path, reported_version="8.30.0")

    assert result.returncode != 0
    assert "unexpected gitleaks version" in result.stderr
    assert not (tmp_path / "installed/gitleaks").exists()
