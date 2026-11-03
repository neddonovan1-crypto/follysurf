import { WorkerEntrypoint } from 'cloudflare:workers';
import { analyzeCameraCapture } from '../server/camera-analysis.js';
import { reviewCameraSurfaceBursts } from '../server/camera-surface-review.js';

/** Service-binding RPC only. No public HTTP endpoint or cron is added. */
export class CameraAnalysis extends WorkerEntrypoint<Cloudflare.Env> {
  async reviewSurface(job: Parameters<typeof reviewCameraSurfaceBursts>[0]) {
    return reviewCameraSurfaceBursts(job, this.env);
  }
  async analyze(job: Parameters<typeof analyzeCameraCapture>[0]) {
    return analyzeCameraCapture(job, this.env);
  }
}

