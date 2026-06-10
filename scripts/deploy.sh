#!/usr/bin/env bash
# Reproducible Cloud Run deploy for both driftwood services.
#
# Why this exists: several settings that the live demo DEPENDS ON live only as
# `gcloud run` runtime flags, NOT in any Dockerfile or committed config. A naive
# `gcloud run deploy --source` silently reverts them to platform defaults and the
# incident demo breaks in ways that look like a tenant/app problem. The worst
# offender is the demo app's --concurrency: default 80 makes Cloud Run reject
# saturating load at the EDGE (429s) before it reaches the app pool, so no
# pool_timeout 503s are logged, so Davis never opens a problem, so the agent has
# nothing to investigate. This script pins every such setting in one place.
#
# Pinned settings that regress without it:
#   demo app : --concurrency 250  (THE critical one; reverts to 80 on source deploy)
#              --min/--max-instances 1 (in-memory deploy state must be one instance)
#   agent    : DT_TRACE_ENDPOINT + DT_TRACE_TOKEN  (agent's own spans -> Dynatrace)
#              OTEL_SERVICE_NAME=driftwood-agent (else spans land as service.name=null;
#                 must be env, not code — Resource is built inside get_fast_api_app)
#              APP_URL (-> demo app, so rollback_deployment can reach it)
#              --min-instances 1 (MCP server cold-start is slow; keep one warm)
#
# Usage:
#   scripts/deploy.sh agent      # rebuild image + deploy the agent only
#   scripts/deploy.sh demo       # deploy the demo app only
#   scripts/deploy.sh both       # demo first, then agent (default)
#   scripts/deploy.sh agent --no-build   # redeploy agent without rebuilding the image
#
# Prerequisites (one-time, not created here):
#   - gcloud auth + project access to rapidagent-498217
#   - Secret Manager secrets: DT_ENVIRONMENT, DT_PLATFORM_TOKEN, DT_INGEST_TOKEN
#     (DT_INGEST_TOKEN must carry logs.ingest + events.ingest + openTelemetryTrace.ingest;
#      it is the single ingest credential for demo-app logs AND agent traces)
#   - the runtime service account granted roles/secretmanager.secretAccessor
set -euo pipefail

# ---- constants -------------------------------------------------------------
PROJECT="rapidagent-498217"
REGION="us-east1"

AGENT_SVC="driftwood-agent"
AGENT_IMAGE="us-east1-docker.pkg.dev/${PROJECT}/driftwood/${AGENT_SVC}:latest"
AGENT_MIN_INSTANCES=1

DEMO_SVC="driftwood-inventory"
DEMO_CONCURRENCY=250          # <-- do not lower; see header
DEMO_INSTANCES=1              # min == max == 1: in-memory deploy/pool state stays coherent

# Tenant — the env host is not a secret; the token is (Secret Manager DT_INGEST_TOKEN).
DT_ENV_HOST="egc32068.live.dynatrace.com"
DT_TRACE_ENDPOINT="https://${DT_ENV_HOST}/api/v2/otlp/v1/traces"
DT_OTLP_ENDPOINT="https://${DT_ENV_HOST}/api/v2/otlp/v1/logs"
DT_EVENTS_ENDPOINT="https://${DT_ENV_HOST}/api/v2/events/ingest"

# Resolved after the demo app is up (or read from the live service).
APP_URL=""

# ---- helpers ---------------------------------------------------------------
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

repo_root() { git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel; }

demo_url() {
  gcloud run services describe "$DEMO_SVC" --project="$PROJECT" --region="$REGION" \
    --format="value(status.url)" 2>/dev/null || true
}

# ---- deploy: demo app ------------------------------------------------------
deploy_demo() {
  log "Deploying demo app ($DEMO_SVC) — concurrency=$DEMO_CONCURRENCY, instances=$DEMO_INSTANCES"
  cd "$(repo_root)"
  gcloud run deploy "$DEMO_SVC" \
    --source demo-app/ \
    --project="$PROJECT" --region="$REGION" \
    --allow-unauthenticated \
    --concurrency="$DEMO_CONCURRENCY" \
    --min-instances="$DEMO_INSTANCES" --max-instances="$DEMO_INSTANCES" \
    --memory=512Mi --timeout=300 \
    --set-env-vars="HOST=0.0.0.0,DT_OTLP_ENDPOINT=${DT_OTLP_ENDPOINT},DT_EVENTS_ENDPOINT=${DT_EVENTS_ENDPOINT}" \
    --update-secrets="DT_API_TOKEN=DT_INGEST_TOKEN:latest" \
    --quiet
  APP_URL="$(demo_url)"
  log "Demo app live: $APP_URL"
}

# ---- deploy: agent ---------------------------------------------------------
build_agent_image() {
  log "Building agent image via Cloud Build ($AGENT_IMAGE)"
  cd "$(repo_root)"
  gcloud builds submit --config cloudbuild.cloudrun.yaml --project="$PROJECT" .
}

deploy_agent() {
  # The agent must know the demo app's URL. Use the one we just deployed, or read
  # the live service if deploying the agent alone.
  [ -n "$APP_URL" ] || APP_URL="$(demo_url)"
  if [ -z "$APP_URL" ]; then
    echo "ERROR: demo app URL unknown and $DEMO_SVC not deployed. Run 'both' or deploy demo first." >&2
    exit 1
  fi
  log "Deploying agent ($AGENT_SVC) — APP_URL=$APP_URL, traces -> Dynatrace, min=$AGENT_MIN_INSTANCES"
  cd "$(repo_root)"
  gcloud run deploy "$AGENT_SVC" \
    --image="$AGENT_IMAGE" \
    --project="$PROJECT" --region="$REGION" \
    --allow-unauthenticated \
    --min-instances="$AGENT_MIN_INSTANCES" \
    --set-env-vars="APP_URL=${APP_URL},DT_TRACE_ENDPOINT=${DT_TRACE_ENDPOINT},OTEL_SERVICE_NAME=${AGENT_SVC}" \
    --update-secrets="DT_ENVIRONMENT=DT_ENVIRONMENT:latest,DT_PLATFORM_TOKEN=DT_PLATFORM_TOKEN:latest,DT_TRACE_TOKEN=DT_INGEST_TOKEN:latest" \
    --quiet
  log "Agent live: $(gcloud run services describe "$AGENT_SVC" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
}

# ---- main ------------------------------------------------------------------
TARGET="${1:-both}"
BUILD=1
for arg in "$@"; do [ "$arg" = "--no-build" ] && BUILD=0; done

case "$TARGET" in
  demo)
    deploy_demo
    ;;
  agent)
    [ "$BUILD" -eq 1 ] && build_agent_image
    deploy_agent
    ;;
  both)
    deploy_demo
    [ "$BUILD" -eq 1 ] && build_agent_image
    deploy_agent
    ;;
  *)
    echo "usage: scripts/deploy.sh [demo|agent|both] [--no-build]" >&2
    exit 2
    ;;
esac

log "Done. Verify: scripts/verify-gate.mjs (or drive an investigation on the agent URL)."
