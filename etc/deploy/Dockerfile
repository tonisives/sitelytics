FROM rust:1.93-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev perl make && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
RUN cargo install cargo-leptos

WORKDIR /app
COPY . .

RUN cargo leptos build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/sitelytics ./
COPY --from=builder /app/target/site ./target/site
COPY --from=builder /app/Cargo.toml ./

ENV LEPTOS_SITE_ADDR="0.0.0.0:19000"
ENV LEPTOS_SITE_ROOT="target/site"
EXPOSE 19000

CMD ["./sitelytics"]
