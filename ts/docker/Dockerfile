# x402-conformance: the Python CLI, the Node probe and the MCP server in one image, for any CI system and for the MCP
# registry. Build from the repository root:  docker build -f ts/docker/Dockerfile -t x402-conformance .
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="x402-conformance" \
      org.opencontainers.image.description="x402 conformance and safety checks: 402 answers, fault injection, MCP tools. Never pays." \
      org.opencontainers.image.source="https://github.com/atsp-protocol/x402-conformance" \
      org.opencontainers.image.documentation="https://github.com/atsp-protocol/x402-conformance/blob/main/docs/USING.md" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Optitransfer" \
      io.modelcontextprotocol.server.name="io.github.atsp-protocol/x402-conformance"

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/x402-conformance
COPY pyproject.toml README.md LICENSE NOTICE ./
COPY src ./src
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir . && rm -rf build src/*.egg-info

COPY ts/package.json ts/package-lock.json ts/tsconfig.json ./ts/
COPY ts/src ./ts/src
RUN cd ts && npm ci --no-audit --no-fund && npx tsc -p . && npm prune --omit=dev --no-audit --no-fund

COPY docs/FIXES.md ./docs/FIXES.md
COPY ts/mcp/package.json ts/mcp/package-lock.json ts/mcp/tsconfig.json ts/mcp/server.json ./ts/mcp/
COPY ts/mcp/src ./ts/mcp/src
RUN cd ts/mcp && npm ci --no-audit --no-fund && npx tsc -p . && cp ../../docs/FIXES.md dist/FIXES.md \
 && npm prune --omit=dev --no-audit --no-fund && npm cache clean --force

COPY ts/docker/x402-conformance.sh /usr/local/bin/x402-conformance
RUN ln -s /opt/venv/bin/x402conf /usr/local/bin/x402conf \
 && printf '#!/bin/sh\nexec node /opt/x402-conformance/ts/dist/src/cli.js "$@"\n' > /usr/local/bin/x402conf-svm \
 && printf '#!/bin/sh\nexec node /opt/x402-conformance/ts/mcp/dist/src/bin.js "$@"\n' > /usr/local/bin/x402-conformance-mcp \
 && chmod +x /usr/local/bin/x402conf-svm /usr/local/bin/x402-conformance-mcp

ENV X402CONF_VIA=docker
# Root by default, as CI systems (GitLab, GitHub container jobs) expect to write the checkout. Add --user node to run
# it unprivileged with docker run.
WORKDIR /work
ENTRYPOINT ["x402-conformance"]
