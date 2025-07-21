FROM clickhouse/clickhouse-server:24.3.13.40 AS database-stage

# Install PostgreSQL and other dependencies
RUN apt-get update && apt-get install -y \
    postgresql-common \
    python3.11 \
    python3.11-dev \
    python3-pip \
    openjdk-17-jre-headless \
    wget \
    unzip \
    curl \
    supervisor \
    nginx \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y \
    postgresql-17 \
    postgresql-client-17 \
    postgresql-contrib-17 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Flyway directly
RUN wget -q -O flyway.tar.gz https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/10.5.0/flyway-commandline-10.5.0.tar.gz \
    && mkdir -p /opt/flyway \
    && tar -xzf flyway.tar.gz -C /opt/flyway --strip-components=1 \
    && rm flyway.tar.gz \
    && ln -s /opt/flyway/flyway /usr/local/bin/flyway \
    && flyway -v

# Install Python dependencies
RUN pip3 install --no-cache-dir requests clickhouse-driver tabulate yarl

# Create supervisord directories and copy configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV FLYWAY_URL=jdbc:postgresql://localhost:5432/helicone_test
ENV FLYWAY_USER=postgres
ENV FLYWAY_PASSWORD=password
ENV FLYWAY_LOCATIONS=filesystem:/app/supabase/migrations,filesystem:/app/supabase/migrations_without_supabase
ENV FLYWAY_SQL_MIGRATION_PREFIX=
ENV FLYWAY_SQL_MIGRATION_SEPARATOR=_
ENV FLYWAY_SQL_MIGRATION_SUFFIXES=.sql


COPY ./supabase/migrations /app/supabase/migrations
COPY ./supabase/migrations_without_supabase /app/supabase/migrations_without_supabase
COPY ./clickhouse/migrations /app/clickhouse/migrations
COPY ./clickhouse/seeds /app/clickhouse/seeds
COPY ./clickhouse/ch_hcone.py /app/clickhouse/ch_hcone.py
RUN chmod +x /app/clickhouse/ch_hcone.py

RUN service postgresql start && \
    su - postgres -c "createdb helicone_test" && \
    su - postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'password';\"" && \
    service postgresql stop

# --------------------------------------------------------------------------------------------------------------------

FROM database-stage AS jawn-stage

# Install Node.js 20 and yarn
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

# Copy package files and source code
WORKDIR /app
COPY package.json package.json
COPY yarn.lock yarn.lock
COPY web/package.json web/package.json
COPY packages ./packages
COPY shared ./shared
COPY valhalla ./valhalla
RUN find /app -name ".env.*" -exec rm {} \;

# Install dependencies and build jawn
RUN yarn install \
    && cd valhalla/jawn \
    && yarn install \
    && yarn build \
    && yarn cache clean


# --------------------------------------------------------------------------------------------------------------------

FROM jawn-stage AS web-stage

# Copy package files and source code
WORKDIR /app
COPY web ./web
RUN find /app -name ".env.*" -exec rm {} \;

# Install dependencies and build web
RUN yarn install \
    && cd web \
    && yarn install \
    && yarn build \
    && yarn cache clean

# --------------------------------------------------------------------------------------------------------------------

FROM web-stage AS minio-stage

# Install MinIO server and client
RUN wget -q -O /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio \
    && chmod +x /usr/local/bin/minio \
    && wget -q -O /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc \
    && chmod +x /usr/local/bin/mc

# Create MinIO data directory
RUN mkdir -p /data

ENV POSTGRES_DB=helicone_test
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=password
ENV CLICKHOUSE_DEFAULT_USER=default

ENV CLICKHOUSE_HOST=http://localhost:8123

ENV MINIO_ROOT_USER=minioadmin
ENV MINIO_ROOT_PASSWORD=minioadmin

# --------------------------------------------------------------------------------------------------------------------

FROM minio-stage AS worker-stage
# Layer on worker (proxy)
WORKDIR /worker
COPY worker/package.json ./package.json
RUN yarn && \
    yarn cache clean
COPY worker .
RUN find /worker -name ".env.*" -exec rm {} \;
RUN rm -rf ./.wrangler

# --------------------------------------------------------------------------------------------------------------------

FROM worker-stage AS postgrest-stage
# Layer on PostgRest
RUN wget https://github.com/PostgREST/postgrest/releases/download/v13.0.4/postgrest-v13.0.4-linux-static-x86-64.tar.xz && \
    tar xf postgrest-v13.0.4-linux-static-x86-64.tar.xz && \
    mv postgrest /usr/local/bin/ &&\
    rm postgrest-v13.0.4-linux-static-x86-64.tar.xz
# setup nginx to front end postgrest (to provide /rest/v1 url support)
RUN mv nginx-postgrest.conf /etc/nginx/conf.d/default.conf
WORKDIR /app

# Use supervisord as entrypoint
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

# --------------------------------------------------------------------------------------------------------------------
#FROM helicone/ai-gateway:latest AS gateway-stage
