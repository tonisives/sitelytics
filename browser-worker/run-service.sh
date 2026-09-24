#!/bin/sh
set -eu
cd "$(dirname "$0")"
set -a
. "${SEO_BROWSER_ENV_FILE:-$HOME/.config/sitelytics/seo-browser.env}"
set +a
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"
export KAFKA_TUNNEL_PORT="${KAFKA_TUNNEL_PORT:-19094}"
export KAFKA_BROKERS="127.0.0.1:$KAFKA_TUNNEL_PORT"
kubectl --context tgs -n redpanda port-forward pod/redpanda-0 "$KAFKA_TUNNEL_PORT:9094" > /tmp/sitelytics-seo-tunnel.log 2>&1 &
tunnel_pid=$!
kubectl --context tgs -n utils port-forward service/sitelytics "${SEO_API_TUNNEL_PORT:-19095}:19000" > /tmp/sitelytics-seo-api-tunnel.log 2>&1 &
api_tunnel_pid=$!
worker_pid=''
cleanup() {
 kill "$tunnel_pid" "$api_tunnel_pid" 2>/dev/null || true
 if [ -n "$worker_pid" ]; then kill "$worker_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
sleep 3
node worker.mjs &
worker_pid=$!
while kill -0 "$tunnel_pid" 2>/dev/null && kill -0 "$api_tunnel_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do sleep 5; done
exit 1
