import { prisma, type DealTier } from "@autarb/db";
import {
  mlClient,
  MLServiceUnavailableError,
  type MLListingFeatures,
  type MLPredictionResult,
} from "../ml-client";

export interface MLDealResult {
  listingId: string;
  dealTier: DealTier;
  dealScore: number;
  confidence: number;
  predictedP10: number;
  predictedP50: number;
  predictedP90: number;
  isMLGenerated: true;
}

export async function detectDealsML(listingIds: string[]): Promise<MLDealResult[]> {
  if (listingIds.length === 0) return [];

  // Load listings with all enrichment data
  const listings = await prisma.carListing.findMany({
    where: {
      id: { in: listingIds },
      isActive: true,
    },
    include: {
      nlpFeatures: true,
      taxData: {
        include: { rdwData: true },
      },
    },
  });

  if (listings.length === 0) return [];

  // Build ML feature vectors
  const mlFeatures: MLListingFeatures[] = listings.map(listing => ({
    listing_id: listing.id,
    price: listing.price,
    year: listing.year,
    mileage: listing.mileage,
    fuel_type: listing.fuelType,
    brand: listing.make,
    model: listing.model,
    transmission: listing.transmission,
    description: listing.description,
    photo_count: listing.imageUrls.length,
    platform: listing.source.toLowerCase(),
    city: listing.city,
    kenteken: listing.kenteken,
    // RDW enrichment
    catalogusprijs: listing.taxData?.rdwData?.catalogusprijs ?? null,
    weight_kg: listing.taxData?.rdwData?.gewicht ?? null,
    co2_gkm: listing.taxData?.rdwData?.co2Uitstoot ?? null,
    emission_class: listing.taxData?.rdwData?.euroKlasse ?? null,
    // NLP features
    has_damage_keywords: listing.nlpFeatures?.hasDamageKeywords ?? null,
    has_no_apk_keywords: listing.nlpFeatures?.hasNoApkKeywords ?? null,
    has_export_keywords: listing.nlpFeatures?.hasExportKeywords ?? null,
    has_premium_keywords: listing.nlpFeatures?.hasPremiumKeywords ?? null,
    red_flag_score: listing.nlpFeatures?.redFlagScore ?? null,
    premium_flag_score: listing.nlpFeatures?.premiumFlagScore ?? null,
    description_length: listing.nlpFeatures?.descriptionLength ?? null,
  }));

  try {
    // Call ML service
    const response = await mlClient.scoreBatch(mlFeatures);

    const results: MLDealResult[] = [];

    for (const prediction of response.predictions) {
      // Store ML prediction
      await storePrediction(prediction, response.model_version);

      // Create deal alert for good deals
      const tier = prediction.effective_deal_tier as DealTier;
      if (
        (tier === "OUTSTANDING" || tier === "GREAT") &&
        prediction.confidence >= 0.6
      ) {
        const listing = listings.find(l => l.id === prediction.listing_id);
        if (!listing) continue;

        // Check for existing unacknowledged alert
        const existingAlert = await prisma.dealAlert.findFirst({
          where: { listingId: prediction.listing_id, isAcknowledged: false },
        });
        if (existingAlert) continue;

        await prisma.dealAlert.create({
          data: {
            listingId: prediction.listing_id,
            listingPrice: listing.price,
            averagePrice: prediction.predicted_p50,
            discountPercent: Math.round(
              ((prediction.predicted_p50 - listing.price) / prediction.predicted_p50) *
                100
            ),
            discountEuros: prediction.predicted_p50 - listing.price,
            dealTier: tier,
            dealScore: prediction.deal_score,
            confidence: prediction.confidence,
            isMLGenerated: true,
          },
        });

        results.push({
          listingId: prediction.listing_id,
          dealTier: tier,
          dealScore: prediction.deal_score,
          confidence: prediction.confidence,
          predictedP10: prediction.predicted_p10,
          predictedP50: prediction.predicted_p50,
          predictedP90: prediction.predicted_p90,
          isMLGenerated: true,
        });
      }
    }

    return results;
  } catch (error) {
    if (error instanceof MLServiceUnavailableError) {
      console.warn("ML service unavailable, skipping deal detection for this batch");
      return [];
    }
    throw error;
  }
}

async function storePrediction(
  prediction: MLPredictionResult,
  modelVersion: string
): Promise<void> {
  // Find or create model version record
  let modelVersionRecord = await prisma.mLModelVersion.findUnique({
    where: { version: modelVersion },
  });

  if (!modelVersionRecord) {
    // Create a minimal record if it doesn't exist (model was deployed externally)
    modelVersionRecord = await prisma.mLModelVersion.create({
      data: {
        version: modelVersion,
        status: "CHAMPION",
        modelType: "lightgbm_quantile_v1",
        trainingWindowStart: new Date(),
        trainingWindowEnd: new Date(),
        trainingDatasetSize: 0,
        featureCount: 0,
        isChampion: true,
      },
    });
  }

  await prisma.mLPricePrediction.upsert({
    where: { listingId: prediction.listing_id },
    create: {
      listingId: prediction.listing_id,
      modelVersionId: modelVersionRecord.id,
      predictedP10: prediction.predicted_p10,
      predictedP50: prediction.predicted_p50,
      predictedP90: prediction.predicted_p90,
      dealScore: prediction.deal_score,
      dealTier: prediction.deal_tier as DealTier,
      suspicionFlag: prediction.suspicion_flag,
      modelConfidence: prediction.confidence,
      featureConfidence: prediction.confidence, // ML service provides combined
      sampleConfidence: prediction.confidence,
      overallConfidence: prediction.confidence,
      coverageLevel: prediction.coverage_level,
      hasSafetyCap: prediction.has_safety_cap,
      safetyCapReason: prediction.safety_cap_reason,
      effectiveDealTier: prediction.effective_deal_tier as DealTier,
    },
    update: {
      modelVersionId: modelVersionRecord.id,
      predictedP10: prediction.predicted_p10,
      predictedP50: prediction.predicted_p50,
      predictedP90: prediction.predicted_p90,
      dealScore: prediction.deal_score,
      dealTier: prediction.deal_tier as DealTier,
      suspicionFlag: prediction.suspicion_flag,
      modelConfidence: prediction.confidence,
      featureConfidence: prediction.confidence,
      sampleConfidence: prediction.confidence,
      overallConfidence: prediction.confidence,
      coverageLevel: prediction.coverage_level,
      hasSafetyCap: prediction.has_safety_cap,
      safetyCapReason: prediction.safety_cap_reason,
      effectiveDealTier: prediction.effective_deal_tier as DealTier,
    },
  });
}
