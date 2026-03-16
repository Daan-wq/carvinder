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
    if (!listing.isActive || listing.condition === Condition.DAMAGED) continue;
    if (listing.year === null || listing.mileage === null) continue;
    if (!listing.fuelType || !listing.condition) continue;

    const yearBucket = getYearBucket(listing.year);
    const mileageBucket = getMileageBucket(listing.mileage);

    const profile = await prisma.priceProfile.findUnique({
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

    if (!profile || profile.sampleCount < 5) continue;

    const watchedSearch = await prisma.watchedSearch.findFirst({
      where: {
        sources: {
          hasSome: [listing.source],
        },
        make: listing.make,
        model: listing.model,
      },
    });

    const threshold = watchedSearch?.alertThresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;

    const thresholdPrice = Math.round(
      profile.averagePrice * (1 - threshold / 100)
    );

    if (listing.price >= thresholdPrice) continue;

    const existingAlert = await prisma.dealAlert.findFirst({
      where: {
        listingId,
        isAcknowledged: false,
      },
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

    deals.push({
      alert,
      listing,
      profile,
    });
  }

  return deals;
}
