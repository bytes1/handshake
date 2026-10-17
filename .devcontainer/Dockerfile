FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm

COPY midnight-contract/.compact-version /tmp/compact-version

USER root
COPY .devcontainer/certs/ /usr/local/share/ca-certificates/extra/
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

USER node
ENV PATH="/home/node/.local/bin:${PATH}"

RUN curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh \
    | sh \
  && compact update "$(tr -d '\r\n' < /tmp/compact-version)"
