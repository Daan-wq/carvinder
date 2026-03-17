export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source, Condition, FuelType, MileageBucket, type CarListing, type PriceProfile } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum([Source.MARKTPLAATS, Source.AUTOSCOUT, Source.FACEBOOK, Source.AUCTION, Source.OTHER]).optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.coerce.number().int().optional(),
  yearMax: z.coerce.number().int().optional(),
  priceMin: z.coerce.number().int().optional(),
  priceMax: z.coerce.number().int().optional(),
  mileageMax: z.coerce.number().int().optional(),
  isActive: z.enum(["true", "false"]).transform(v => v === "true").optional(),
  sortBy: z.enum(["recent", "price_asc", "price_desc", "discount"]).default("recent"),
});

type EnrichedListing = CarListing & {
  marketValue: number | null;
  discountPercent: number | null;
  savings: number | null;
  profileSampleCount: number | null;
};

function getYearBucket(year: number): { start: number; end: number } {
  const start = Math.floor(year / 2) * 2;
  return { start, end: start + 1 };
}

function getMileageBucket(km: number): MileageBucket {
  if (km < 50000) return MileageBucket.KM_0_50K;
  if (km < 100000) return MileageBucket.KM_50_100K;
  if (km < 150000) return MileageBucket.KM_100_150K;
  if (km < 200000) return MileageBucket.KM_150_200K;
  return MileageBucket.KM_200K_PLUS;
}

async function enrichListingWithMarketValue(
  listing: CarListing,
  profilesByKey: Map<string, PriceProfile[]>
): Promise<EnrichedListing> {
  const enriched = listing as EnrichedListing;
  enriched.marketValue = null;
  enriched.discountPercent = null;
  enriched.savings = null;
  enriched.profileSampleCount = null;

  if (!listing.year || !listing.mileage) {
    return enriched;
  }

  const condition = listing.condition || Condition.USED_GOOD;
  const yearBucket = getYearBucket(listing.year);
  const mileageBucket = getMileageBucket(listing.mileage);

  // Try exact match: year + mileage + fuel
  let profile = findBestProfile(
    profilesByKey,
    listing.make,
    listing.model,
    yearBucket,
    mileageBucket,
    listing.fuelType,
    condition
  );

  // Fallback: year + mileage, any fuel (highest sampleCount)
  if (!profile) {
    profile = findBestProfileAnyFuel(
      profilesByKey,
      listing.make,
      listing.model,
      yearBucket,
      mileageBucket,
      condition
    );
  }

  // Fallback: year only, any mileage, any fuel (highest sampleCount)
  if (!profile) {
    profile = findBestProfileYearOnly(
      profilesByKey,
      listing.make,
      listing.model,
      yearBucket,
      condition
    );
  }

  if (profile) {
    enriched.marketValue = profile.averagePrice;
    enriched.profileSampleCount = profile.sampleCount;
    enriched.discountPercent = Math.round(
      ((profile.averagePrice - listing.price) / profile.averagePrice) * 100
    );
    enriched.savings = profile.averagePrice - listing.price;
  }

  return enriched;
}

function findBestProfile(
  profilesByKey: Map<string, PriceProfile[]>,
  make: string,
  model: string,
  yearBucket: { start: number; end: number },
  mileageBucket: MileageBucket,
  fuelType: FuelType | null,
  condition: Condition
): PriceProfile | null {
  if (!fuelType) return null;

  const key = `${make}:${model}`;
  const profiles = profilesByKey.get(key) || [];

  return (
    profiles.find(
      p =>
        p.yearBucketStart === yearBucket.start &&
        p.yearBucketEnd === yearBucket.end &&
        p.mileageBucket === mileageBucket &&
        p.fuelType === fuelType &&
        p.condition === condition
    ) || null
  );
}

function findBestProfileAnyFuel(
  profilesByKey: Map<string, PriceProfile[]>,
  make: string,
  model: string,
  yearBucket: { start: number; end: number },
  mileageBucket: MileageBucket,
  condition: Condition
): PriceProfile | null {
  const key = `${make}:${model}`;
  const profiles = profilesByKey.get(key) || [];

  const matches = profiles.filter(
    p =>
      p.yearBucketStart === yearBucket.start &&
      p.yearBucketEnd === yearBucket.end &&
      p.mileageBucket === mileageBucket &&
      p.condition === condition
  );

  return matches.sort((a, b) => b.sampleCount - a.sampleCount)[0] || null;
}

function findBestProfileYearOnly(
  profilesByKey: Map<string, PriceProfile[]>,
  make: string,
  model: string,
  yearBucket: { start: number; end: number },
  condition: Condition
): PriceProfile | null {
  const key = `${make}:${model}`;
  const profiles = profilesByKey.get(key) || [];

  const matches = profiles.filter(
    p =>
      p.yearBucketStart === yearBucket.start &&
      p.yearBucketEnd === yearBucket.end &&
      p.condition === condition
  );

  return matches.sort((a, b) => b.sampleCount - a.sampleCount)[0] || null;
}

function sortListings(
  listings: EnrichedListing[],
  sortBy: string
): EnrichedListing[] {
  if (sortBy === "price_asc") {
    return [...listings].sort((a, b) => a.price - b.price);
  }
  if (sortBy === "price_desc") {
    return [...listings].sort((a, b) => b.price - a.price);
  }
  if (sortBy === "discount") {
    return [...listings].sort(
      (a, b) => (b.discountPercent ?? -Infinity) - (a.discountPercent ?? -Infinity)
    );
  }
  return listings; // recent (default DB order)
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = querySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      page,
      limit,
      source,
      make,
      model,
      yearMin,
      yearMax,
      priceMin,
      priceMax,
      mileageMax,
      isActive,
      sortBy,
    } = parsed.data;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (source) where.source = source;
    if (make) where.make = make;
    if (model) where.model = model;
    if (yearMin !== undefined) where.year = { ...where.year, gte: yearMin };
    if (yearMax !== undefined) where.year = { ...where.year, lte: yearMax };
    if (priceMin !== undefined) where.price = { ...where.price, gte: priceMin };
    if (priceMax !== undefined) where.price = { ...where.price, lte: priceMax };
    if (mileageMax !== undefined) where.mileage = { ...where.mileage, lte: mileageMax };
    if (isActive !== undefined) where.isActive = isActive;

    const [listings, total] = await Promise.all([
      prisma.carListing.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.carListing.count({ where }),
    ]);

    // Batch-fetch price profiles for all make/model combos
    const makeModelCombos = [...new Set(listings.map(l => `${l.make}:${l.model}`))];
    const makeModelPairs = makeModelCombos.map(combo => {
      const [makeName, modelName] = combo.split(":");
      return { make: makeName, model: modelName };
    });

    const priceProfiles = await prisma.priceProfile.findMany({
      where: {
        OR: makeModelPairs,
      },
    });

    // Build lookup map: "make:model" -> array of profiles
    const profilesByKey = new Map<string, PriceProfile[]>();
    for (const profile of priceProfiles) {
      const key = `${profile.make}:${profile.model}`;
      if (!profilesByKey.has(key)) {
        profilesByKey.set(key, []);
      }
      profilesByKey.get(key)!.push(profile);
    }

    // Enrich each listing
    const enrichedListings = await Promise.all(
      listings.map(listing => enrichListingWithMarketValue(listing, profilesByKey))
    );

    // Sort if needed
    const finalListings = sortListings(enrichedListings, sortBy);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      listings: finalListings,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching listings:", error);
    return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}
