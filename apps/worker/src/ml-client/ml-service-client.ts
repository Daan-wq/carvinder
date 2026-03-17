import { z } from "zod";

// ============================================================================
// Error Classes
// ============================================================================

export class MLServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "MLServiceError";
  }
}

export class MLServiceUnavailableError extends MLServiceError {
  constructor(message: string, details?: unknown) {
    super(message, 503, details);
    this.name = "MLServiceUnavailableError";
  }
}

// ============================================================================
// Validation Schemas
// ============================================================================

const MLListingFeaturesSchema = z.object({
  listing_id: z.string(),
  price: z.number(),
  year: z.number().nullable().optional(),
  mileage: z.number().nullable().optional(),
  fuel_type: z.string().nullable().optional(),
  brand: z.string(),
  model: z.string(),
  transmission: z.string().nullable().optional(),
  body_type: z.string().nullable().optional(),
  power_kw: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  photo_count: z.number().nullable().optional(),
  seller_type: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  kenteken: z.string().nullable().optional(),
  catalogusprijs: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  co2_gkm: z.number().nullable().optional(),
  emission_class: z.string().nullable().optional(),
  apk_days_remaining: z.number().nullable().optional(),
  is_import: z.boolean().nullable().optional(),
  has_damage_keywords: z.boolean().nullable().optional(),
  has_no_apk_keywords: z.boolean().nullable().optional(),
  has_export_keywords: z.boolean().nullable().optional(),
  has_premium_keywords: z.boolean().nullable().optional(),
  red_flag_score: z.number().nullable().optional(),
  premium_flag_score: z.number().nullable().optional(),
  description_length: z.number().nullable().optional(),
});

const MLScoringRequestSchema = z.object({
  listings: z.array(MLListingFeaturesSchema),
});

const MLPredictionResultSchema = z.object({
  listing_id: z.string(),
  model_version: z.string(),
  predicted_p10: z.number(),
  predicted_p50: z.number(),
  predicted_p90: z.number(),
  deal_score: z.number(),
  deal_tier: z.enum(["OUTSTANDING", "GREAT", "FAIR", "HIGH", "OVERPRICED"]),
  confidence: z.number(),
  suspicion_flag: z.boolean(),
  coverage_level: z.number(),
  has_safety_cap: z.boolean(),
  safety_cap_reason: z.string().nullable(),
  effective_deal_tier: z.enum(["OUTSTANDING", "GREAT", "FAIR", "HIGH", "OVERPRICED"]),
});

const MLScoringResponseSchema = z.object({
  predictions: z.array(MLPredictionResultSchema),
  timestamp: z.string(),
  model_version: z.string(),
});

const MLHealthStatusSchema = z.object({
  status: z.string(),
  model_loaded: z.boolean(),
  model_version: z.string().nullable(),
  database: z.string(),
  uptime_seconds: z.number(),
});

const MLModelStatusSchema = z.object({
  champion: z
    .object({
      version: z.string(),
      status: z.string(),
      rmse_p50: z.number().optional(),
      coverage_p10_p90: z.number().optional(),
      psi_score: z.number().optional(),
    })
    .nullable(),
  challenger: z
    .object({
      version: z.string(),
      status: z.string(),
    })
    .nullable(),
  total_predictions: z.number(),
  service_health: z.string(),
});

const MLTrainingResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
});

// ============================================================================
// Exported Types
// ============================================================================

export type MLListingFeatures = z.infer<typeof MLListingFeaturesSchema>;
export type MLScoringRequest = z.infer<typeof MLScoringRequestSchema>;
export type MLPredictionResult = z.infer<typeof MLPredictionResultSchema>;
export type MLScoringResponse = z.infer<typeof MLScoringResponseSchema>;
export type MLHealthStatus = z.infer<typeof MLHealthStatusSchema>;
export type MLModelStatus = z.infer<typeof MLModelStatusSchema>;

// ============================================================================
// ML Service Client
// ============================================================================

const DEFAULT_ML_SERVICE_URL = "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_LISTINGS_PER_BATCH = 100;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff: 1s, 2s, 4s

export class MLServiceClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs?: number) {
    this.baseUrl = baseUrl || process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Score a batch of listings (up to 100 per request).
   * If more than 100 listings, automatically chunks them into sequential requests.
   */
  async scoreBatch(listings: MLListingFeatures[]): Promise<MLScoringResponse> {
    if (listings.length === 0) {
      return {
        predictions: [],
        timestamp: new Date().toISOString(),
        model_version: "unknown",
      };
    }

    if (listings.length <= MAX_LISTINGS_PER_BATCH) {
      return this._scoreBatchInternal(listings);
    }

    // Chunk into multiple batches
    const batches: MLListingFeatures[][] = [];
    for (let i = 0; i < listings.length; i += MAX_LISTINGS_PER_BATCH) {
      batches.push(listings.slice(i, i + MAX_LISTINGS_PER_BATCH));
    }

    const results: MLPredictionResult[] = [];
    let modelVersion = "unknown";
    let latestTimestamp = new Date().toISOString();

    for (const batch of batches) {
      const response = await this._scoreBatchInternal(batch);
      results.push(...response.predictions);
      modelVersion = response.model_version;
      latestTimestamp = response.timestamp;
    }

    return {
      predictions: results,
      timestamp: latestTimestamp,
      model_version: modelVersion,
    };
  }

  /**
   * Health check endpoint
   */
  async checkHealth(): Promise<MLHealthStatus> {
    return this._fetchWithRetry(
      `${this.baseUrl}/health`,
      { method: "GET" },
      MLHealthStatusSchema
    );
  }

  /**
   * Get model status (champion/challenger versions)
   */
  async getModelStatus(): Promise<MLModelStatus> {
    return this._fetchWithRetry(
      `${this.baseUrl}/api/model/status`,
      { method: "GET" },
      MLModelStatusSchema
    );
  }

  /**
   * Trigger model training job
   */
  async triggerTraining(force?: boolean): Promise<{ job_id: string; status: string }> {
    const response = await this._fetchWithRetry(
      `${this.baseUrl}/api/train`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: force ?? false }),
      },
      MLTrainingResponseSchema
    );
    return {
      job_id: response.job_id,
      status: response.status,
    };
  }

  /**
   * Quick availability check — returns false on any error
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.checkHealth();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Internal: Score a batch without chunking (max 100 listings)
   */
  private async _scoreBatchInternal(listings: MLListingFeatures[]): Promise<MLScoringResponse> {
    const payload: MLScoringRequest = { listings };

    // Validate request shape (catches bad input early)
    try {
      MLScoringRequestSchema.parse(payload);
    } catch (error) {
      throw new MLServiceError(
        `Invalid scoring request: ${error instanceof Error ? error.message : "unknown"}`,
        400,
        error
      );
    }

    return this._fetchWithRetry(
      `${this.baseUrl}/api/score`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      MLScoringResponseSchema
    );
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async _fetchWithRetry<T>(
    url: string,
    init: RequestInit,
    schema: z.ZodSchema<T>
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this._fetchWithTimeout(url, init);

        // Handle non-200 status codes
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const error = new MLServiceError(
            `ML Service returned ${response.status}: ${errorBody || response.statusText}`,
            response.status,
            { url, status: response.status, body: errorBody }
          );

          // Don't retry on 4xx errors (bad request, not found, etc.)
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }

          lastError = error;
          if (attempt < MAX_RETRIES - 1) {
            await this._sleep(RETRY_DELAYS[attempt]);
          }
          continue;
        }

        // Parse and validate response
        const data = await response.json();
        try {
          return schema.parse(data);
        } catch (error) {
          throw new MLServiceError(
            `Invalid ML Service response: ${error instanceof Error ? error.message : "unknown"}`,
            502,
            { url, data, parseError: error }
          );
        }
      } catch (error) {
        lastError = error as Error;

        // Network errors and timeouts are retriable
        const isNetworkError =
          error instanceof TypeError || (error instanceof MLServiceError && !error.statusCode);

        if (isNetworkError && attempt < MAX_RETRIES - 1) {
          await this._sleep(RETRY_DELAYS[attempt]);
          continue;
        }

        // Non-retriable error or final attempt
        if (error instanceof MLServiceError) {
          throw error;
        }

        throw new MLServiceUnavailableError(
          `Failed to connect to ML Service: ${lastError?.message || "unknown"}`,
          { url, originalError: lastError }
        );
      }
    }

    // All retries exhausted
    throw new MLServiceUnavailableError(
      `ML Service unavailable after ${MAX_RETRIES} attempts`,
      { url, lastError: lastError?.message }
    );
  }

  /**
   * Fetch with timeout
   */
  private async _fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Request timeout after ${this.timeoutMs}ms: ${url}`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const mlClient = new MLServiceClient();
