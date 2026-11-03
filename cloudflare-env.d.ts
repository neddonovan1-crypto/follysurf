declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    BUCKET?: R2Bucket;
    TOMTOM_API_KEY?: string;
    GOOGLE_MAPS_API_KEY?: string;
  }
}
