import vinext from "vinext";
import { defineConfig } from "vite";

// One configuration for local development and the production Worker.
export default defineConfig(async () => {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      ...(process.env.CODEX_SANDBOX === "seatbelt"
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          name: "folly-surf",
          main: "./build/cloudflare-worker.ts",
          compatibility_date: "2026-05-15",
          compatibility_flags: ["nodejs_compat"],
          workers_dev: true,
          preview_urls: false,
          routes: [{ pattern: "follysurf.com", custom_domain: true }],
          assets: { binding: "ASSETS", run_worker_first: ["/api/*"] },
          r2_buckets: [
            { binding: "BUCKET", bucket_name: "folly-surf-forecasts" },
          ],
          triggers: { crons: ["0 */6 * * *"] },
          observability: { enabled: true },
        },
      }),
    ],
  };
});
