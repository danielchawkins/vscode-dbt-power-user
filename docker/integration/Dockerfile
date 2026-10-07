# Linux arm64 image for running integration labels. Repo tooling only; nothing here ships.
FROM --platform=linux/arm64 debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth libasound2 libgbm1 libgtk-3-0 libnss3 libxss1 libsecret-1-0 \
      libdrm2 libxkbcommon0 libatk-bridge2.0-0 libcups2 dbus \
      python3 perl git curl ca-certificates unzip xz-utils fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Electron's sandbox refuses to start as root, and the VSIX launches pass no --no-sandbox,
# so everything runs as this user.
RUN useradd --create-home --uid 1000 --shell /bin/sh tester \
    && mkdir /work && chown tester:tester /work
USER tester

# mise, then Node and Fusion from the repo lock. The real dbt binary goes first on PATH: tests run `dbt` from PATH
# in directories where no mise.toml applies, and a mise shim fails there.
ENV MISE_DATA_DIR=/home/tester/.local/share/mise \
    MISE_TRUSTED_CONFIG_PATHS=/work \
    MISE_YES=1 \
    FPU_INTEGRATION_DBT_PATH=/home/tester/.local/bin/dbt \
    PATH=/home/tester/.local/bin:/home/tester/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin
RUN curl -fsSL https://mise.run | MISE_VERSION=v2026.9.12 sh

WORKDIR /work
COPY --chown=tester:tester mise.toml mise.lock ./
RUN mise install --locked node "aqua:getdbt.com/dbt-fusion" \
    && ln -s "$(mise which dbt)" /home/tester/.local/bin/dbt

# Dependencies come from the lockfile; test-electron is one of them. VS Code is baked into /work/.vscode-test,
# where test-electron looks when the tests run from /work.
COPY --chown=tester:tester package.json package-lock.json ./
RUN npm ci --strict-allow-scripts
COPY --chown=tester:tester scripts/test/integration-layout.mjs scripts/test/
COPY --chown=tester:tester docker/integration/fetch-vscode.mjs docker/integration/
RUN node docker/integration/fetch-vscode.mjs
