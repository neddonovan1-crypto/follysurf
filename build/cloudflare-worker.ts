export { CameraAnalysis } from "./camera-analysis-entrypoint";
import handler from "vinext/server/fetch-handler";
import { getConditions } from "../server/conditions.js";
import { getCoastal } from "../server/coastal.js";
import { getSpectra } from "../server/spectra.js";
import { getWaveSpectra } from "../server/wave-spectra.js";
import { archiveObservation } from "../server/history.js";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // Public dashboard and first-party API routes.
    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ) {
    if (!env.BUCKET) throw new Error("Forecast archive binding is unavailable");
    // Retain spectra first so the subsequent rating snapshot has all candidate
    // inputs available prospectively. Visitor condition requests stay independent.
    const waveSpectra = await getWaveSpectra({ bucket: env.BUCKET, force: true }).catch(() => ({ status: "unavailable", archiveSaved: false }));
    const [conditions, observations] = await Promise.all([
      getConditions({ bucket: env.BUCKET, collectionMode: "scheduled", force: true }),
      Promise.allSettled([
        getCoastal({ bucket: env.BUCKET }).then(result => archiveObservation(env.BUCKET, "coastal", result)),
        getSpectra({ bucket: env.BUCKET }).then(result => archiveObservation(env.BUCKET, "spectra", result)),
      ]),
    ]);
    const hasFreshSource = Object.values(conditions.sources).some(
      (source) => source?.status === "fresh" && source.data,
    );
    if (!conditions.archive.active || !hasFreshSource) {
      throw new Error("Scheduled collection did not persist fresh forecast data");
    }
    // A successful write is evidence of an actual completed run. Configuring a
    // trigger by itself never makes the UI claim collection is already active.
    await env.BUCKET.put(
      "status/scheduled.json",
      JSON.stringify({ completedAt: Date.now() / 1000, status: "ok", waveSpectra: { status: waveSpectra.status, saved: waveSpectra.archiveSaved }, observations: observations.map((result, index) => ({ source: index === 0 ? "coastal" : "spectra", status: result.status, saved: result.status === "fulfilled" ? result.value : false })) }),
      { httpMetadata: { contentType: "application/json" } },
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
