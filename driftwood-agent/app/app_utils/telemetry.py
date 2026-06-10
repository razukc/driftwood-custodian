# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import os


def attach_dynatrace_traces() -> bool:
    """Fan the agent's spans out to Dynatrace alongside the Google Cloud exporter.

    ADK's get_fast_api_app(otel_to_cloud=True) installs the global TracerProvider
    and a Cloud Trace exporter. OpenTelemetry ignores a second set_tracer_provider,
    so instead of replacing it we grab the existing provider and bolt a second
    BatchSpanProcessor onto it — every span now goes to BOTH backends. This makes
    the agent observable in the very tenant it investigates.

    Opt-in via env (unset locally, set on Cloud Run): DT_TRACE_ENDPOINT (the
    classic OTLP traces path, e.g. https://<env>.live.dynatrace.com/api/v2/otlp/
    v1/traces) and DT_TRACE_TOKEN (an Api-Token with openTelemetryTrace.ingest —
    the same R-token the demo app ingests logs with). Both required; returns
    False (and stays silent) if either is missing so local runs are unaffected.
    """
    endpoint = os.environ.get("DT_TRACE_ENDPOINT")
    token = os.environ.get("DT_TRACE_TOKEN")
    if not (endpoint and token):
        logging.info(
            "Dynatrace trace export off (set DT_TRACE_ENDPOINT + DT_TRACE_TOKEN to enable)"
        )
        return False

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        # No SDK provider installed (e.g. otel_to_cloud disabled) — nothing to
        # bolt onto. Don't silently swallow: a no-op provider means no spans.
        logging.warning(
            "Dynatrace trace export skipped: global TracerProvider is %s, not an "
            "SDK TracerProvider — no spans would be exported.",
            type(provider).__name__,
        )
        return False

    # Dynatrace classic OTLP wants Api-Token auth in the Authorization header.
    exporter = OTLPSpanExporter(
        endpoint=endpoint,
        headers={"Authorization": f"Api-Token {token}"},
        timeout=30,
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    logging.info("Dynatrace trace export on -> %s", endpoint)
    return True


def setup_telemetry() -> str | None:
    """Configure OpenTelemetry and GenAI telemetry with GCS upload."""

    bucket = os.environ.get("LOGS_BUCKET_NAME")
    capture_content = os.environ.get(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "false"
    )
    if bucket and capture_content != "false":
        logging.info(
            "Prompt-response logging enabled - mode: NO_CONTENT (metadata only, no prompts/responses)"
        )
        os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "NO_CONTENT"
        os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_UPLOAD_FORMAT", "jsonl")
        os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_COMPLETION_HOOK", "upload")
        os.environ.setdefault(
            "OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental"
        )
        commit_sha = os.environ.get("COMMIT_SHA", "dev")
        os.environ.setdefault(
            "OTEL_RESOURCE_ATTRIBUTES",
            f"service.namespace=driftwood-agent,service.version={commit_sha}",
        )
        path = os.environ.get("GENAI_TELEMETRY_PATH", "completions")
        os.environ.setdefault(
            "OTEL_INSTRUMENTATION_GENAI_UPLOAD_BASE_PATH",
            f"gs://{bucket}/{path}",
        )
    else:
        logging.info(
            "Prompt-response logging disabled (set LOGS_BUCKET_NAME=gs://your-bucket and OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT to enable)"
        )

    return bucket
