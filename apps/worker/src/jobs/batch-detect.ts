import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { prisma, Condition, type PriceProfile } from "@autarb/db";
import { getYearBucket, getMileageBucket } from "../utils/buckets";

const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 5000;
const THRESHOLD_PERCENT = 15;

interface ProfileLookupKey {
  exact: string;
  partial: string;
  yearOnly: string;
}

function buildProfileKeys(
  make: string,
  model: string,
  year: number | null,
  mileage: number | null,
  fuelType: string | null
): ProfileLookupKey {
  const yearBucket = year ? getYearBucket(year) : null;
  const mileageBucket = mileage ? getMileageBucket(mileage) : null;

  const makeModel = `${make.toUpperCase()}|${model.toUpperCase()}`;

  let exact = "";
  let partial = "";
  let yearOnly = "";

  if (yearBucket && mileageBucket && fuelType) {
    exact = `${makeModel}|${yearBucket.start}|${mileageBucket}|${fuelType}`;
  }

  if (yearBucket && mileageBucket) {
    partial = `${makeModel}|${yearBucket.start}|${mileageBucket}`;
  }

  if (yearBucket) {
    yearOnly = `${makeModel}|${yearBucket.start}`;
  }

  return { exact, partial, yearOnly };
}

async function buildProfileMap(): Promise<Map<string, PriceProfile>> {
  console.log("Loading all price profiles into memory...");

  const profiles = await prisma.priceProfile.findMany({
    where: { sampleCount: { gte: 3 } },
  });

  const profileMap = new Map<string, PriceProfile>();

  for (const profile of profiles) {
    const key = `${profile.make.toUpperCase()}|${profile.model.toUpperCase()}|${profile.yearBucketStart}|${profile.mileageBucket}|${profile.fuelType}`;
    const existing = profileMap.get(key);

    if (!existing || profile.sampleCount > existing.sampleCount) {
      profileMap.set(key, profile);
    }
  }

  console.log(`Loaded ${profiles.length} profiles, ${profileMap.size} unique keys`);
  return profileMap;
}

function findMatchingProfile(
  profileMap: Map<string, PriceProfile>,
  keys: ProfileLookupKey,
  make: string,
  model: string,
  year: number | null
): PriceProfile | null {
  const yearBucket = year ? getYearBucket(year) : null;

  // Exact match
  if (keys.exact) {
    const exactMatch = profileMap.get(keys.exact);
    if (exactMatch) return exactMatch;
  }

  // Partial match (no fuel type)
  if (keys.partial) {
    let bestMatch: PriceProfile | null = null;
    for (const [key, profile] of profileMap) {
      if (key.startsWith(keys.partial) && profile.sampleCount >= 3) {
        if (!bestMatch || profile.sampleCount > bestMatch.sampleCount) {
          bestMatch = profile;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }

  // Year only match
  if (keys.yearOnly && yearBucket) {
    let bestMatch: PriceProfile | null = null;
    for (const [key, profile] of profileMap) {
      if (
        key.startsWith(keys.yearOnly) &&
        profile.sampleCount >= 5 &&
        profile.make.toUpperCase() === make.toUpperCase() &&
        profile.model.toUpperCase() === model.toUpperCase()
      ) {
        if (!bestMatch || profile.sampleCount > bestMatch.sampleCount) {
          bestMatch = profile;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

async function processBatch(
  listings: Array<{
    id: string;
    make: string;
    model: string;
    year: number | null;
    mileage: number | null;
    price: number;
    fuelType: string | null;
    condition: string | null;
    source: string;
  }>,
  profileMap: Map<string, PriceProfile>,
  watchedSearchMap: Map<string, number>
): Promise<number> {
  let dealsCreated = 0;

  const newAlerts = [];

  for (const listing of listings) {
    // Filter: has year AND mileage to match profiles
    if (!listing.year || !listing.mileage) continue;

    const keys = buildProfileKeys(
      listing.make,
      listing.model,
      listing.year,
      listing.mileage,
      listing.fuelType
    );

    const profile = findMatchingProfile(
      profileMap,
      keys,
      listing.make,
      listing.model,
      listing.year
    );

    if (!profile) continue;

    // Get threshold from watched search, or use default
    const thresholdKey = `${listing.make}|${listing.source}`;
    const threshold = watchedSearchMap.get(thresholdKey) ?? THRESHOLD_PERCENT;
    const thresholdPrice = Math.round(profile.averagePrice * (1 - threshold / 100));

    if (listing.price >= thresholdPrice) continue;

    newAlerts.push({
      listingId: listing.id,
      profileId: profile.id,
      listingPrice: listing.price,
      averagePrice: profile.averagePrice,
      discountEuros: Math.round(profile.averagePrice - listing.price),
      discountPercent: Math.round(
        ((profile.averagePrice - listing.price) / profile.averagePrice) * 100
      ),
      isAcknowledged: false,
    });
  }

  if (newAlerts.length > 0) {
    // Check for existing alerts and filter out
    const existingListingIds = (
      await prisma.dealAlert.findMany({
        where: {
          listingId: { in: newAlerts.map((a) => a.listingId) },
          isAcknowledged: false,
        },
        select: { listingId: true },
      })
    ).map((a) => a.listingId);

    const toInsert = newAlerts.filter(
      (a) => !existingListingIds.includes(a.listingId)
    );

    if (toInsert.length > 0) {
      await prisma.dealAlert.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      dealsCreated = toInsert.length;
    }
  }

  return dealsCreated;
}

async function main() {
  try {
    console.log("Starting batch deal detection...");
    console.time("Total Time");

    // Load profiles into memory
    const profileMap = await buildProfileMap();

    // Load watched searches into memory
    console.log("Loading watched searches...");
    const watchedSearches = await prisma.watchedSearch.findMany({
      select: { make: true, sources: true, alertThresholdPercent: true },
    });

    const watchedSearchMap = new Map<string, number>();
    for (const ws of watchedSearches) {
      for (const source of ws.sources) {
        const key = `${ws.make}|${source}`;
        watchedSearchMap.set(key, ws.alertThresholdPercent ?? THRESHOLD_PERCENT);
      }
    }

    // Fetch all active, non-damaged listings with year AND mileage
    console.log("Fetching listings...");
    const listings = await prisma.carListing.findMany({
      where: {
        isActive: true,
        condition: { not: Condition.DAMAGED },
        year: { not: null },
        mileage: { not: null },
      },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        mileage: true,
        price: true,
        fuelType: true,
        condition: true,
        source: true,
      },
    });

    console.log(`Found ${listings.length} listings to process`);

    let totalDealsCreated = 0;
    let processedCount = 0;

    // Process in batches
    for (let i = 0; i < listings.length; i += BATCH_SIZE) {
      const batch = listings.slice(i, i + BATCH_SIZE);
      const dealsInBatch = await processBatch(batch, profileMap, watchedSearchMap);
      totalDealsCreated += dealsInBatch;
      processedCount += batch.length;

      if (processedCount % PROGRESS_INTERVAL === 0 || processedCount === listings.length) {
        console.log(
          `Processed ${processedCount}/${listings.length} listings, ${totalDealsCreated} deals created so far`
        );
      }
    }

    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Total listings processed: ${listings.length}`);
    console.log(`Total deals created: ${totalDealsCreated}`);
    console.timeEnd("Total Time");

    await prisma.$disconnect();
  } catch (error) {
    console.error("Error in batch deal detection:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
