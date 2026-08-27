#!/usr/bin/env bash
#
# Assert that the local Midnight devnet genuinely came up.
#
# Runs CONCURRENTLY with `npm start`, for two reasons:
#
#   1. The app tears the network down in its own `finally` block, so by the time
#      a later workflow step runs, the containers (and their volumes) are gone.
#   2. testcontainers cannot be relied on to notice a service that dies during
#      startup. If a container has already exited when the compose environment is
#      listed, its wait strategy is skipped with only a WARN and `up()` still
#      resolves successfully — the app then logs "Midnight standalone network is
#      running." with a dead indexer. Only an independent check catches that.
set -uo pipefail

CONTAINERS=(midnight-node midnight-indexer midnight-proof-server)
TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"
deadline=$((SECONDS + TIMEOUT_SECONDS))

# Same overrides the application honours, so this still checks the right
# endpoints when the stack is published somewhere other than the defaults.
NODE_PORT="${MN_NODE_PORT:-9944}"
INDEXER_PORT="${MN_INDEXER_PORT:-8088}"
PROOF_SERVER_PORT="${MN_PROOF_SERVER_PORT:-6300}"

diagnostics() {
  echo "----- container states -----"
  docker ps -a --filter 'name=midnight-' --format '{{.Names}}	{{.Status}}' || true
  for c in "${CONTAINERS[@]}"; do
    echo "----- docker logs ${c} (last 60 lines) -----"
    docker logs --tail 60 "${c}" 2>&1 || true
  done
}

fail() {
  echo "::error::$*"
  diagnostics
  exit 1
}

container_state() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo missing; }
container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo none
}

echo "Waiting up to ${TIMEOUT_SECONDS}s for every devnet container to report healthy..."
for c in "${CONTAINERS[@]}"; do
  while true; do
    state=$(container_state "${c}")
    health=$(container_health "${c}")

    case "${state}" in
      exited | dead)
        fail "${c} exited before becoming healthy (state=${state}, health=${health})"
        ;;
    esac

    if [ "${health}" = healthy ]; then
      echo "  [ok] ${c} is healthy"
      break
    fi

    if [ "${SECONDS}" -ge "${deadline}" ]; then
      fail "${c} did not become healthy within ${TIMEOUT_SECONDS}s (state=${state}, health=${health})"
    fi
    sleep 3
  done
done

# Host-side reachability. The clients bind to 127.0.0.1 with no environment
# override, so these are the exact endpoints a DApp on the runner would use.
echo "Checking host-side reachability..."

# curl already prints "000" for a connection failure, so the exit status is
# swallowed rather than adding a second value to the output.
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || true; }

node_code=$(http_code "http://127.0.0.1:${NODE_PORT}/health")
[ "${node_code}" = 200 ] || fail "node /health on ${NODE_PORT} returned HTTP ${node_code}"
echo "  [ok] node reachable on ${NODE_PORT}"

proof_code=$(http_code "http://127.0.0.1:${PROOF_SERVER_PORT}/health")
[ "${proof_code}" = 200 ] || fail "proof-server /health on ${PROOF_SERVER_PORT} returned HTTP ${proof_code}"
echo "  [ok] proof-server reachable on ${PROOF_SERVER_PORT}"

indexer_code=$(http_code -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ __typename }"}' "http://127.0.0.1:${INDEXER_PORT}/api/v4/graphql")
[ "${indexer_code}" = 200 ] || fail "indexer GraphQL on ${INDEXER_PORT} returned HTTP ${indexer_code}"
echo "  [ok] indexer GraphQL reachable on ${INDEXER_PORT}"

echo "All three services are healthy and reachable from the host."
