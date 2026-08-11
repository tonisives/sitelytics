# -- Rust API build --
FROM rust:1.93-slim AS rust-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev libcurl4-openssl-dev libsasl2-dev cmake make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY migrations migrations
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release 2>/dev/null; exit 0

COPY src src
RUN touch src/main.rs && cargo build --release

# -- Frontend build --
FROM node:22-slim AS frontend-builder

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app/frontend

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend .
RUN pnpm build

# -- Runtime --
FROM node:22-slim

RUN apt-get update && apt-get install -y ca-certificates curl libsasl2-2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=rust-builder /app/target/release/sitelytics ./sitelytics
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY --from=frontend-builder /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-builder /app/frontend/package.json ./frontend/package.json

ENV API_BASE_URL="http://localhost:19100"
ENV API_PORT="19100"
ENV NODE_ENV="production"
ENV PORT="19000"
EXPOSE 19000

CMD ./sitelytics & cd frontend && node dist/fastify/server/index.js
