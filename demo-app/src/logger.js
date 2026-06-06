import pino from "pino";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { config } from "./config.js";

const pinoLogger = pino({ level: "info" });

const SEVERITY = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

let provider = null;
let otelLogger = null;

if (process.env.OTLP_DISABLED !== "1") {
  if (!process.env.DT_OTLP_ENDPOINT || !process.env.DT_API_TOKEN) {
    throw new Error(
      "DT_OTLP_ENDPOINT and DT_API_TOKEN are required when OTLP export is on " +
        "(load .env, or set OTLP_DISABLED=1 for offline mode)"
    );
  }
  // Export failures must warn on the console and never crash or block the app.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  provider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "driftwood-inventory",
      "service.version": config.version, // startup version; live signal is per-record deployment.version
      "deployment.environment": "production", // the fiction
    }),
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: process.env.DT_OTLP_ENDPOINT,
          headers: { Authorization: `Api-Token ${process.env.DT_API_TOKEN}` },
        }),
        { scheduledDelayMillis: 1000 } // short interval: demo lag should be ingestion-side only
      ),
    ],
  });
  logs.setGlobalLoggerProvider(provider);
  otelLogger = logs.getLogger("driftwood-inventory");
}

// level: "info" | "warn" | "error". Message stays a plain string; structure goes
// in attributes — the poisoned user_agent must render as readable text on camera.
export function log(level, message, attributes = {}) {
  const attrs = { "deployment.version": config.version, ...attributes };
  pinoLogger[level](attrs, message);
  otelLogger?.emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes: attrs,
  });
}

export async function shutdownLogging() {
  await provider?.shutdown(); // flushes pending batches
}
