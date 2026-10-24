FROM oven/bun:1

# rg  -> in-process search adapter
# git -> available to downstream servers installed from GitHub
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

ENV ARIVE_LOG=info
ENTRYPOINT ["bun", "run", "src/index.ts"]
