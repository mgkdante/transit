from __future__ import annotations

import argparse
import os
import re
import sys
from collections.abc import Sequence

import psycopg
from psycopg import sql

POSTGRES_DSN_RE = re.compile(r"\b(postgresql|postgres)://([^:\s/@]+):([^@\s]+)@")
QUOTED_HOST_WITH_AT_RE = re.compile(
    r"((?:host|hostname) ['\"])[^'\"]+@([^'\"]+['\"])",
    re.IGNORECASE,
)
REPORTING_RESTRICTED_SCHEMAS = ("raw", "silver", "core", "public")
DB_ALLOWED_SCHEMAS = ("raw", "core", "silver", "gold")
DB_RESTRICTED_SCHEMAS = ("public",)
CONNECT_TIMEOUT_SECONDS = 10
NETWORK_FAILURE_MARKERS = (
    "connection timeout",
    "connection timed out",
    "timeout expired",
    "could not translate host name",
    "name or service not known",
    "temporary failure in name resolution",
    "nodename nor servname provided",
    "connection refused",
    "no route to host",
    "network is unreachable",
    "operation timed out",
)
EXPECTED_HBA_REJECTION_MARKERS = (
    "no pg_hba.conf entry",
    "pg_hba.conf rejects connection",
)
RELKIND_LABELS = {
    "r": "table",
    "p": "partitioned table",
    "v": "view",
    "m": "materialized view",
    "f": "foreign table",
}


class VerificationError(RuntimeError):
    pass


def redact_dsn(message: str) -> str:
    redacted = POSTGRES_DSN_RE.sub(r"\1://\2:<redacted>@", message)
    return QUOTED_HOST_WITH_AT_RE.sub(r"\1<redacted>@\2", redacted)


def is_network_failure_message(message: str) -> bool:
    normalized = message.casefold()
    return any(marker in normalized for marker in NETWORK_FAILURE_MARKERS)


def is_expected_hba_rejection_message(message: str) -> bool:
    normalized = message.casefold()
    return any(marker in normalized for marker in EXPECTED_HBA_REJECTION_MARKERS)


def print_pass(message: str) -> None:
    print(f"PASS: {message}")


def schema_exists(cur: psycopg.Cursor[object], schema_name: str) -> bool:
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = %s)",
        (schema_name,),
    )
    return bool(cur.fetchone()[0])


def schema_usage(cur: psycopg.Cursor[object], schema_name: str) -> bool:
    cur.execute("SELECT has_schema_privilege(current_user, %s, 'USAGE')", (schema_name,))
    return bool(cur.fetchone()[0])


def verify_current_user(cur: psycopg.Cursor[object], expected_user: str) -> None:
    cur.execute("SELECT current_user")
    current_user = str(cur.fetchone()[0])
    if current_user != expected_user:
        raise VerificationError(f"current_user is {current_user!r}, expected {expected_user!r}")
    print_pass(f"current_user is {expected_user}")


def verify_tls(cur: psycopg.Cursor[object]) -> None:
    cur.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
    row = cur.fetchone()
    if row is None or row[0] is not True:
        raise VerificationError("current connection is not TLS-backed according to pg_stat_ssl")
    print_pass("current connection uses TLS")


def verify_schema_usage(cur: psycopg.Cursor[object], schema_name: str) -> None:
    if not schema_exists(cur, schema_name):
        raise VerificationError(f"{schema_name} schema does not exist")
    if not schema_usage(cur, schema_name):
        raise VerificationError(f"current user lacks USAGE on {schema_name}")
    print_pass(f"current user has USAGE on {schema_name}")


def schema_select_relations(
    cur: psycopg.Cursor[object],
    schema_name: str,
) -> list[tuple[str, str, bool]]:
    cur.execute(
        """
        SELECT
          c.relname,
          c.relkind,
          has_table_privilege(current_user, c.oid, 'SELECT')
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %s
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY c.relname
        """,
        (schema_name,),
    )
    return [
        (str(name), str(relkind), bool(has_select))
        for name, relkind, has_select in cur.fetchall()
    ]


def verify_schema_select(cur: psycopg.Cursor[object], schema_name: str) -> None:
    relations = schema_select_relations(cur, schema_name)
    if not relations:
        print_pass(f"no {schema_name} table-like relations; schema privilege exists")
        return

    for relation_name, _relkind, has_select in relations:
        if not has_select:
            raise VerificationError(f"current user lacks SELECT on {schema_name}.{relation_name}")

    print_pass(f"current user has SELECT on {len(relations)} {schema_name} relations")

    table_name, relkind = relations[0][0], relations[0][1]
    cur.execute(
        sql.SQL("SELECT * FROM {}.{} LIMIT 1").format(
            sql.Identifier(schema_name),
            sql.Identifier(table_name),
        ),
    )
    print_pass(
        f"SELECT from {schema_name}.{table_name} "
        f"({RELKIND_LABELS.get(relkind, relkind)}) succeeds"
    )


def verify_gold_usage(cur: psycopg.Cursor[object]) -> None:
    verify_schema_usage(cur, "gold")


def gold_select_relations(cur: psycopg.Cursor[object]) -> list[tuple[str, str, bool]]:
    return schema_select_relations(cur, "gold")


def verify_gold_select(cur: psycopg.Cursor[object]) -> None:
    verify_schema_select(cur, "gold")


def verify_restricted_schema_usage(
    cur: psycopg.Cursor[object],
    schemas: tuple[str, ...] = REPORTING_RESTRICTED_SCHEMAS,
) -> None:
    for schema_name in schemas:
        if not schema_exists(cur, schema_name):
            print_pass(f"{schema_name} schema does not exist")
            continue
        if schema_usage(cur, schema_name):
            raise VerificationError(f"current user unexpectedly has USAGE on {schema_name}")
        print_pass(f"current user lacks USAGE on {schema_name}")


def verify_statement_fails(
    conn: psycopg.Connection[object],
    statement: sql.SQL | str,
    pass_message: str,
    cleanup_statement: sql.SQL | str | None = None,
) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(statement)
    except Exception as exc:
        if getattr(exc, "sqlstate", None) != psycopg.errors.InsufficientPrivilege.sqlstate:
            raise
        print_pass(f"{pass_message}: {redact_dsn(str(exc))}")
        return

    if cleanup_statement is not None:
        try:
            with conn.cursor() as cur:
                cur.execute(cleanup_statement)
        except Exception as exc:
            print(
                redact_dsn(f"cleanup after unexpected write success failed: {exc}"),
                file=sys.stderr,
            )

    raise VerificationError(f"unexpectedly succeeded: {statement}")


def verify_temp_table_allowed(conn: psycopg.Connection[object]) -> None:
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE transit_db_temp_probe(id integer)")
        cur.execute("DROP TABLE transit_db_temp_probe")
    print_pass("CREATE TEMP TABLE succeeds")


def verify_read_only(conn: psycopg.Connection[object]) -> None:
    verify_statement_fails(
        conn,
        sql.SQL("CREATE TABLE {}.{}(id integer)").format(
            sql.Identifier("gold"),
            sql.Identifier("transit_reporting_write_probe"),
        ),
        "CREATE TABLE in gold fails",
        sql.SQL("DROP TABLE IF EXISTS {}.{}").format(
            sql.Identifier("gold"),
            sql.Identifier("transit_reporting_write_probe"),
        ),
    )
    verify_statement_fails(
        conn,
        "CREATE TEMP TABLE transit_reporting_temp_probe(id integer)",
        "CREATE TEMP TABLE fails",
        "DROP TABLE IF EXISTS transit_reporting_temp_probe",
    )


def verify_db_read_only(conn: psycopg.Connection[object]) -> None:
    verify_statement_fails(
        conn,
        sql.SQL("CREATE TABLE {}.{}(id integer)").format(
            sql.Identifier("silver"),
            sql.Identifier("transit_db_write_probe"),
        ),
        "CREATE TABLE in silver fails",
        sql.SQL("DROP TABLE IF EXISTS {}.{}").format(
            sql.Identifier("silver"),
            sql.Identifier("transit_db_write_probe"),
        ),
    )
    verify_temp_table_allowed(conn)


def run_positive_verification(
    database_url: str,
    expected_user: str,
    role_contract: str = "reporting",
) -> int:
    try:
        with psycopg.connect(
            database_url,
            autocommit=True,
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
        ) as conn:
            with conn.cursor() as cur:
                verify_current_user(cur, expected_user)
                verify_tls(cur)
                if role_contract == "reporting":
                    verify_gold_usage(cur)
                    verify_gold_select(cur)
                    verify_restricted_schema_usage(cur)
                elif role_contract == "db":
                    for schema_name in DB_ALLOWED_SCHEMAS:
                        verify_schema_usage(cur, schema_name)
                        verify_schema_select(cur, schema_name)
                    verify_restricted_schema_usage(cur, DB_RESTRICTED_SCHEMAS)
                else:
                    raise VerificationError(f"unknown role contract: {role_contract}")
            if role_contract == "reporting":
                verify_read_only(conn)
            else:
                verify_db_read_only(conn)
    except Exception as exc:
        print(redact_dsn(f"FAIL: {exc}"), file=sys.stderr)
        return 1

    print_pass(f"{expected_user} is TLS-backed, read-only, and matches {role_contract}")
    return 0


def run_expected_connect_failure(database_url: str) -> int:
    try:
        with psycopg.connect(database_url, connect_timeout=CONNECT_TIMEOUT_SECONDS):
            pass
    except Exception as exc:
        message = redact_dsn(str(exc))
        if is_expected_hba_rejection_message(message):
            print_pass(f"connection failed at the HBA/TLS gate: {message}")
            return 0
        if is_network_failure_message(message):
            print(
                f"FAIL: connection failed before Postgres authorization: {message}",
                file=sys.stderr,
            )
            return 1
        print(
            f"FAIL: connection did not prove HBA/TLS rejection: {message}",
            file=sys.stderr,
        )
        return 1

    print("FAIL: connection unexpectedly succeeded", file=sys.stderr)
    return 1


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the Transit external SQL reader contracts.",
    )
    parser.add_argument("--database-url-env", default="TRANSIT_REPORTING_DATABASE_URL")
    parser.add_argument("--expected-user", default="transit-reporting")
    parser.add_argument("--role-contract", choices=("reporting", "db"), default="reporting")
    parser.add_argument("--expect-connect-failure", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        print(f"{args.database_url_env} is not set", file=sys.stderr)
        return 2

    if args.expect_connect_failure:
        return run_expected_connect_failure(database_url)
    return run_positive_verification(database_url, args.expected_user, args.role_contract)


if __name__ == "__main__":
    raise SystemExit(main())
