# Multi-stage: build deps, then thin runtime
FROM node:20-slim AS builder

# Install build dependencies: Python, uv, build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.12 python3.12-dev python3.12-venv \
    build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Runtime stage: Node 20 + Python 3.12 slim
FROM node:20-slim

# Copy Python from builder
COPY --from=builder /usr/bin/python3.12 /usr/bin/python3.12
COPY --from=builder /usr/lib/python3.12 /usr/lib/python3.12
COPY --from=builder /root/.cargo/bin/uv /usr/local/bin/uv

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpython3.12 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create /app directory with read-only mount
RUN mkdir -p /app /tmp

WORKDIR /app

# Copy agent source code
COPY driftwood-agent/app/ ./app/
COPY driftwood-agent/agents-cli-manifest.yaml ./
COPY driftwood-agent/.env ./.env.agent

# Copy pre-packaged MCP server (no npm install at runtime)
COPY node_modules/@dynatrace-oss/dynatrace-mcp-server/ ./mcp-server/

# Install Python agent dependencies
RUN --mount=type=cache,target=/root/.cache/pip \
    /usr/bin/python3.12 -m venv /opt/venv && \
    /opt/venv/bin/python -m pip install --upgrade pip && \
    /opt/venv/bin/python -m pip install \
      google-adk==1.34.3 \
      google-genai==0.9.4 \
      google-cloud-aiplatform==1.69.0 \
      google-auth==2.36.0 \
      pydantic==2.10.2

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    GOOGLE_GENAI_USE_VERTEXAI=True

# Interactive entrypoint: agents-cli run with piped input
ENTRYPOINT ["/bin/bash", "-c", "source /opt/venv/bin/activate && cd /app && agents-cli run"]
