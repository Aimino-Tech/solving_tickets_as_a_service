import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseExporter } from "langfuse-vercel";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

/**
 * Initializes the OpenTelemetry SDK with a LangFuse exporter.
 *
 * Reads configuration from environment variables:
 * - LANGFUSE_HOST  – LangFuse self-hosted endpoint (default: http://localhost:3000)
 * - LANGFUSE_PUBLIC_KEY  – Public key for LangFuse project
 * - LANGFUSE_SECRET_KEY  – Secret key for LangFuse project
 *
 * Call once at process start (e.g. in the eval runner entry point).
 */
export function initTelemetry(): void {
  const host = process.env.LANGFUSE_HOST || "http://localhost:3000";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.warn(
      "[otel-setup] LANGFUSE_PUBLIC_KEY and/or LANGFUSE_SECRET_KEY not set — telemetry will not be exported",
    );
    return;
  }

  const sdk = new NodeSDK({
    traceExporter: new LangfuseExporter({
      host,
      publicKey,
      secretKey,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  // Gracefully shut down the SDK on process exit
  process.on("SIGTERM", () => {
    sdk
      .shutdown()
      .then(() => console.log("[otel-setup] OpenTelemetry SDK shut down"))
      .catch((err) =>
        console.error("[otel-setup] Error shutting down OpenTelemetry SDK", err),
      );
  });

  process.on("SIGINT", () => {
    sdk
      .shutdown()
      .then(() => console.log("[otel-setup] OpenTelemetry SDK shut down"))
      .catch((err) =>
        console.error("[otel-setup] Error shutting down OpenTelemetry SDK", err),
      );
  });
}
