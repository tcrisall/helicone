#!/bin/bash

# cheezy delay while we wait for migrations to hopefully finish...
sleep 60
cd /worker
export PGRST_DB_URI=$DATABASE_URL
export PGRST_DB_SCHEMAS=public
export PGRST_DB_ANON_ROLE=postgres
export PGRST_SERVER_PORT=5430
export PGRST_JWT_SECRET=Ah6j2uYPLr4bN9cXpZq7Wt5vM1KsB8Qw
export PGRST_LOG_LEVEL=debug
exec /usr/local/bin/postgrest
