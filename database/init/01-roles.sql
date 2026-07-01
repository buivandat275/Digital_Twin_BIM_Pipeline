\set reader_user `echo "$POSTGRES_READER_USER"`
\set reader_password `echo "$POSTGRES_READER_PASSWORD"`
\set db_name `echo "$POSTGRES_DB"`

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'reader_user', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader_user')\gexec

GRANT CONNECT ON DATABASE :"db_name" TO :"reader_user";
GRANT USAGE ON SCHEMA public TO :"reader_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :"reader_user";
