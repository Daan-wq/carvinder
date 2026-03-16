import {
  prisma,
  type CarListing,
  type DealAlert,
  type PriceProfile,
  Condition,
} from "@autarb/db";
import { getYearBucket, getMileageBucket } from "../utils/buckets";

export interface DealWithDetails {
  alert: DealAlert;
  listing: CarListing;
  profile: PriceProfile;
}

const DEFAULT_THRESHOLD_PERCENT = 15;

export async function detectDeals(listingIds: string[]): Promise<DealWithDetails[]> {
  const deals: DealWithDetails[] = [];

  for (const listingId of listingIds) {
    const listing = await prisma.carListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) continue;
    if (!listing.isActive) continue;
    if (listing.condition === Condition.DAMAGED) continue;
    // Need at least price and either year or mileage to find a meaningful profile
    if (!listing.year && !listing.mileage) continue;

    const profile = await findBestProfile(listing);
    if (!profile || profile.sampleCount < 3) continue;

    const watchedSearch = await prisma.watchedSearch.findFirst({
      where: {
        sources: { hasSome: [listing.source] },
        make: { equals: listing.make, mode: "insensitive" },
      },
    });

    const threshold = watchedSearch?.alertThresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
    const thresholdPrice = Math.round(profile.averagePrice * (1 - threshold / 100));

    if (listing.price >= thresholdPrice) continue;

    const existingAlert = await prisma.dealAlert.findFirst({
      where: { listingId, isAcknowledged: false },
    });
    if (existingAlert) continue;

    const discountEuros = Math.round(profile.averagePrice - listing.price);
    const discountPercent = Math.round(
      ((profile.averagePrice - listing.price) / profile.averagePrice) * 100
    );

    const alert = await prisma.dealAlert.create({
      data: {
        listingId,
        profileId: profile.id,
        listingPrice: listing.price,
        averagePrice: profile.averagePrice,
        discountEuros,
        discountPercent,
        isAcknowledged: false,
      },
    });

    deals.push({ alert, listing, profile });
  }

  return deals;
}

async function findBestProfile(listing: CarListing): Promise<PriceProfile | null> {
  if (!listing.year && !listing.mileage) return null;

  const yearBucket = listing.year ? getYearBucket(listing.year) : null;
  const mileageBucket = listing.mileage ? getMileageBucket(listing.mileage) : null;

  // Try exact match first (make + model + year + mileage + fuelType + condition)
  if (yearBucket && mileageBucket && listing.fuelType && listing.condition) {
    const exact = await prisma.priceProfile.findUnique({
      where: {
        make_model_yearBucketStart_yearBucketEnd_mileageBucket_fuelType_condition: {
          make: listing.make,
          model: listing.model,
          yearBucketStart: yearBucket.start,
          yearBucketEnd: yearBucket.end,
          mileageBucket,
          fuelType: listing.fuelType,
          condition: listing.condition,
        },
      },
    });
    if (exact && exact.sampleCount >= 3) return exact;
  }

  // Fall back: match make + model + year + mileage, ignore fuelType/condition
  if (yearBucket && mileageBucket) {
    const partial = await prisma.priceProfile.findFirst({
      where: {
        make: { equals: listing.make, mode: "insensitive" },
        model: { equals: listing.model, mode: "insensitive" },
        yearBucketStart: yearBucket.start,
        yearBucketEnd: yearBucket.end,
        mileageBucket,
        sampleCount: { gte: 3 },
      },
      orderBy: { sampleCount: "desc" },
    });
    if (partial) return partial;
  }

  // Last resort: match make + model + year bucket only
  if (yearBucket) {
    return prisma.priceProfile.findFirst({
      where: {
        make: { equals: listing.make, mode: "insensitive" },
        model: { equals: listing.model, mode: "insensitive" },
        yearBucketStart: yearBucket.start,
        yearBucketEnd: yearBucket.end,
        sampleCount: { gte: 5 },
      },
      orderBy: { sampleCount: "desc" },
    });
  }

  return null;
}
