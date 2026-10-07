# Linux arm64 image for packaged-VSIX smoke, built on the integration image. Repo tooling only; nothing here ships.
# BASE is the integration image tag; scripts/smoke/docker-smoke.sh builds it first.
ARG BASE
FROM ${BASE}

USER root
# The Cursor .deb's Depends (`dpkg-deb -I`) that the integration image lacks or might lack, named explicitly so a
# base-image change cannot drop them. No keyring is installed: neither host asked for one in the smoke run.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libxkbfile1 libsecret-1-0 libasound2 libgbm1 libgtk-3-0 libnss3 libxkbcommon0 libatk1.0-0 \
      libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libexpat1 libudev1 libnspr4 libx11-6 libxcb1 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libcurl4 \
      libglib2.0-0 xdg-utils \
    && rm -rf /var/lib/apt/lists/*
USER tester

# Both pinned Linux hosts land in the default cache, so a run downloads nothing.
WORKDIR /home/tester/smoke-fetch
COPY --chown=tester:tester scripts/smoke/pins.env scripts/smoke/common.sh scripts/smoke/fetch-host.sh \
     scripts/smoke/fetch-vscode.sh scripts/smoke/fetch-cursor.sh scripts/smoke/
# fetch-vscode.sh runs `node`, and a mise shim fails outside /work, so this step puts the real Node first on PATH.
RUN PATH="$(dirname "$(cd /work && mise which node)"):$PATH" bash scripts/smoke/fetch-host.sh all
WORKDIR /work
