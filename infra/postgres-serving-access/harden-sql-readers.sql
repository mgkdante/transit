\set ON_ERROR_STOP on

SET password_encryption = 'scram-sha-256';

SELECT format('CREATE ROLE %I LOGIN', :'reporting_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reporting_role')
\gexec

SELECT format('CREATE ROLE %I LOGIN', :'db_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_role')
\gexec

ALTER ROLE :"reporting_role" WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'transit_reporting_password';

ALTER ROLE :"db_role" WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  PASSWORD :'transit_db_password';

REVOKE CONNECT ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name" TO :"app_owner";
GRANT CONNECT ON DATABASE :"database_name" TO :"reporting_role";
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name" TO :"db_role";
REVOKE TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM :"reporting_role";

\connect :database_name

WITH target_schemas AS (
  SELECT nspname
  FROM pg_catalog.pg_namespace
  WHERE nspname = ANY (ARRAY['raw', 'silver', 'core', 'gold', 'public'])
),
target_grantees AS (
  SELECT 'PUBLIC' AS grantee, false AS quote_grantee
  UNION ALL
  SELECT :'reporting_role' AS grantee, true AS quote_grantee
  UNION ALL
  SELECT :'db_role' AS grantee, true AS quote_grantee
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

GRANT USAGE ON SCHEMA gold TO :"reporting_role";
GRANT SELECT ON ALL TABLES IN SCHEMA gold TO :"reporting_role";

GRANT USAGE ON SCHEMA raw, core, silver, gold TO :"db_role";
GRANT SELECT ON ALL TABLES IN SCHEMA raw TO :"db_role";
GRANT SELECT ON ALL TABLES IN SCHEMA core TO :"db_role";
GRANT SELECT ON ALL TABLES IN SCHEMA silver TO :"db_role";
GRANT SELECT ON ALL TABLES IN SCHEMA gold TO :"db_role";

-- All future Gold DDL is expected to run as app_owner; re-run this script after
-- exceptional DBA-created objects or add matching default privileges for that owner.
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA gold
  GRANT SELECT ON TABLES TO :"reporting_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA raw
  GRANT SELECT ON TABLES TO :"db_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA core
  GRANT SELECT ON TABLES TO :"db_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA silver
  GRANT SELECT ON TABLES TO :"db_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_owner" IN SCHEMA gold
  GRANT SELECT ON TABLES TO :"db_role";
