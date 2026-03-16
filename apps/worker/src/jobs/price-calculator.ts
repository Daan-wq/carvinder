import {
  prisma,
  Condition,
  MileageBucket,
  FuelType,
  type CarListing,
} from "@autarb/db";
import { getYearBucket, getMileageBucket } from "../utils/buckets";

function calculateStats(prices: number[]): {
  average: number;
  median: number;
  p10: number;
  p90: number;
} {
  if (prices.length === 0) {
    return { average: 0, median: 0, p10: 0, p90: 0 };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const average = Math.round(
    prices.reduce((sum, p) => sum + p, 0) / prices.length
  );

  const median =
    sorted.length % 2 === 0
      ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : sorted[Math.floor(sorted.length / 2)];

  const p10Index = Math.floor(sorted.length * 0.1);
  const p10 = sorted[p10Index];

  const p90Index = Math.floor(sorted.length * 0.9);
  const p90 = sorted[p90Index];

  return { average, median, p10, p90 };
}

function removeOutliers(prices: number[]): number[] {
  if (prices.length < 3) return prices;

  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const variance =
    prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);

  return prices.filter(p => Math.abs(p - mean) <= 2 * stddev);
}

interface GroupKey {
  yearBucketStart: number;
  yearBucketEnd: number;
  mileageBucket: MileageBucket;
  fuelType: FuelType;
  condition: Condition;
}

interface Group {
  prices: number[];
}

export async function recalculatePriceProfiles(
  affectedKeys: Array<{ make: string; model: string }>
): Promise<number> {
  const uniqueKeys = Array.from(
    new Map(affectedKeys.map(k => [`${k.make}|${k.model}`, k])).values()
  );

  let profilesUpdated = 0;

  for (const key of uniqueKeys) {
    const listings = await prisma.carListing.findMany({
      where: {
        make: key.make,
        model: key.model,
        isActive: true,
        condition: { not: Condition.DAMAGED },
      },
      select: {
        year: true,
        mileage: true,
        price: true,
        fuelType: true,
        condition: true,
      },
    });

    const groups = new Map<string, Group>();

    for (const listing of listings) {
      if (listing.year === null || listing.mileage === null) continue;

      const yearBucket = getYearBucket(listing.year);
      const mileageBucket = getMileageBucket(listing.mileage);

      // Default to USED_GOOD and PETROL when not specified — allows profiles to be
      // built from list-page scrapes that don't have detail-page enrichment yet.
      const groupKey: GroupKey = {
        yearBucketStart: yearBucket.start,
        yearBucketEnd: yearBucket.end,
        mileageBucket,
        fuelType: listing.fuelType ?? FuelType.PETROL,
        condition: listing.condition ?? Condition.USED_GOOD,
      };

      const keyStr = JSON.stringify(groupKey);

      if (!groups.has(keyStr)) {
        groups.set(keyStr, { prices: [] });
      }

      const group = groups.get(keyStr)!;
      group.prices.push(listing.price);
    }

    for (const [keyStr, group] of groups.entries()) {
      if (group.prices.length < 5) continue;

      const cleaned = removeOutliers(group.prices);
      if (cleaned.length === 0) continue;

      const stats = calculateStats(cleaned);
      const groupKey = JSON.parse(keyStr) as GroupKey;

      await prisma.priceProfile.upsert({
        where: {
          make_model_yearBucketStart_yearBucketEnd_mileageBucket_fuelType_condition: {
            make: key.make,
            model: key.model,
            yearBucketStart: groupKey.yearBucketStart,
            yearBucketEnd: groupKey.yearBucketEnd,
            mileageBucket: groupKey.mileageBucket,
            fuelType: groupKey.fuelType,
            condition: groupKey.condition,
          },
        },
        update: {
          averagePrice: stats.average,
          medianPrice: stats.median,
          p10Price: stats.p10,
          p90Price: stats.p90,
          sampleCount: cleaned.length,
          lastCalculatedAt: new Date(),
        },
        create: {
          make: key.make,
          model: key.model,
          yearBucketStart: groupKey.yearBucketStart,
          yearBucketEnd: groupKey.yearBucketEnd,
          mileageBucket: groupKey.mileageBucket,
          fuelType: groupKey.fuelType,
          condition: groupKey.condition,
          averagePrice: stats.average,
          medianPrice: stats.median,
          p10Price: stats.p10,
          p90Price: stats.p90,
          sampleCount: cleaned.length,
          lastCalculatedAt: new Date(),
        },
      });

      profilesUpdated++;
    }
  }

  return profilesUpdated;
}
