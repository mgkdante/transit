\set ON_ERROR_STOP on

SET password_encryption = 'scram-sha-256';

SELECT format('CREATE ROLE %I LOGIN', :'reader_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader_role')
\gexec

ALTER ROLE :"reader_role" WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'powerbi_reader_password';

REVOKE CONNECT ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name" TO :"app_owner";
GRANT CONNECT ON DATABASE :"database_name" TO :"reader_role";
REVOKE TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM :"reader_role";

\connect :database_name

WITH target_schemas AS (
  SELECT nspname
  FROM pg_catalog.pg_namespace
  WHERE nspname = ANY (ARRAY['raw', 'silver', 'core', 'public'])
),
target_grantees AS (
  SELECT 'PUBLIC' AS grantee, false AS quote_grantee
  UNION ALL
  SELECT :'reader_role' AS grantee, true AS quote_grantee
),
commands AS (
  SELECT format(
    'REVOKE ALL ON SCHEMA %I FROM %s',
    nspname,
    CASE WHEN quote_grantee THEN format('%I', grantee) ELSE grantee END
  ) AS command
  FROM target_schemas
  CROSS JOIN target_grantees
  UNION ALL
  SELECT format(
    'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %s',
    nspname,
    CASE WHEN quote_grantee THEN format('%I', grantee) ELSE grantee END
  ) AS command
  FROM target_schemas
  CROSS JOIN target_grantees
  UNION ALL
  SELECT format(
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %s',
    nspname,
    CASE WHEN quote_grantee THEN format('%I', grantee) ELSE grantee END
  ) AS command
  FROM target_schemas
  CROSS JOIN target_grantees
  UNION ALL
  SELECT format(
    'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %s',
    nspname,
    CASE WHEN quote_grantee THEN format('%I', grantee) ELSE grantee END
  ) AS command
  FROM target_schemas
  CROSS JOIN target_grantees
)
SELECT command FROM commands
\gexec

GRANT USAGE ON SCHEMA gold TO :"reader_role";
GRANT SELECT ON ALL TABLES IN SCHEMA gold TO :"reader_role";

-- All future Gold DDL is expected to run as app_owner; re-run this script after
-- exceptional DBA-created Gold objects or add matching default privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA gold GRANT SELECT ON TABLES TO :"reader_role";
