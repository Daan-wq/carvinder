import { prisma, type CarListing } from "@autarb/db";

export interface DeduplicationStats {
  kentekenDuplicates: number;
  fuzzyDuplicates: number;
  potentialDuplicates: number;
  crossPlatformSpread: Array<{
    make: string;
    model: string;
    year?: number;
    kenteken?: string;
    lowestPrice: number;
    highestPrice: number;
    spread: number;
    platforms: string[];
  }>;
}

interface FuzzyCandidates {
  make: string;
  model: string;
  year: number;
  fuelType: string;
  listings: CarListing[];
}

interface SimilarityScore {
  listingA: CarListing;
  listingB: CarListing;
  score: number;
  factors: Record<string, number>;
}

/**
 * Deduplication job: identifies and marks duplicate listings.
 * Strategy 1: Kenteken-based (perfect match across platforms)
 * Strategy 2: Fuzzy matching (when kenteken unavailable)
 */
export async function deduplicateListings(): Promise<DeduplicationStats> {
  const stats: DeduplicationStats = {
    kentekenDuplicates: 0,
    fuzzyDuplicates: 0,
    potentialDuplicates: 0,
    crossPlatformSpread: [],
  };

  // Strategy 1: Kenteken-based deduplication
  stats.kentekenDuplicates = await deduplicateByKenteken();

  // Strategy 2: Fuzzy matching for listings without kenteken
  const fuzzyResult = await deduplicateByFuzzyMatching();
  stats.fuzzyDuplicates = fuzzyResult.autoDedup;
  stats.potentialDuplicates = fuzzyResult.potential;

  // Track cross-platform price spreads for insight
  stats.crossPlatformSpread = await findCrossPlatformSpreads();

  return stats;
}

/**
 * Strategy 1: Kenteken-based deduplication
 * Groups listings by kenteken and marks lower-priced ones as duplicates.
 */
async function deduplicateByKenteken(): Promise<number> {
  // Fetch all active listings with kenteken, grouped by kenteken
  const groupedByKenteken = await prisma.carListing.groupBy({
    by: ["kenteken"],
    where: {
      kenteken: { not: null },
      isActive: true,
    },
    _count: true,
  });

  let deduplicatedCount = 0;

  for (const group of groupedByKenteken) {
    if (!group.kenteken || group._count < 2) continue;

    // Fetch all listings with this kenteken
    const listings = await prisma.carListing.findMany({
      where: {
        kenteken: group.kenteken,
        isActive: true,
      },
      orderBy: { price: "asc" },
    });

    if (listings.length < 2) continue;

    // Keep the lowest-priced listing as primary
    const primaryListing = listings[0];
    const duplicates = listings.slice(1);

    // Mark other listings as duplicates
    for (const duplicate of duplicates) {
      await prisma.carListing.update({
        where: { id: duplicate.id },
        data: {
          isActive: false,
          rawData: {
            ...((duplicate.rawData as Record<string, unknown>) || {}),
            deduplicationReason: "kenteken_duplicate",
            primaryListingId: primaryListing.id,
            primarySource: primaryListing.source,
            primaryPrice: primaryListing.price,
            deduplicatedAt: new Date().toISOString(),
          },
        },
      });
      deduplicatedCount++;
    }
  }

  return deduplicatedCount;
}

/**
 * Strategy 2: Fuzzy matching for listings without kenteken
 * Groups by (make, model, year±1, fuel_type) then applies similarity scoring.
 */
async function deduplicateByFuzzyMatching(): Promise<{
  autoDedup: number;
  potential: number;
}> {
  let autoDedup = 0;
  let potential = 0;

  // Fetch all active listings without kenteken
  const listingsWithoutKenteken = await prisma.carListing.findMany({
    where: {
      kenteken: null,
      isActive: true,
    },
  });

  // Group by (make, model, year±1, fuelType)
  const candidates = groupByAttributes(listingsWithoutKenteken);

  for (const group of candidates) {
    if (group.listings.length < 2) continue;

    // Compare all pairs within the group
    const similarities: SimilarityScore[] = [];

    for (let i = 0; i < group.listings.length; i++) {
      for (let j = i + 1; j < group.listings.length; j++) {
        const score = calculateSimilarity(group.listings[i], group.listings[j]);
        similarities.push(score);
      }
    }

    // Process matches based on score threshold
    for (const { listingA, listingB, score } of similarities) {
      if (score > 0.85) {
        // Auto-deduplicate: keep lowest price
        const [primary, duplicate] =
          listingA.price <= listingB.price
            ? [listingA, listingB]
            : [listingB, listingA];

        await markAsDuplicate(duplicate, primary, "fuzzy_auto", score);
        autoDedup++;
      } else if (score > 0.7) {
        // Log as potential duplicate
        await logPotentialDuplicate(listingA, listingB, score);
        potential++;
      }
    }
  }

  return { autoDedup, potential };
}

/**
 * Groups listings into candidates for fuzzy matching.
 * Blocking: (make, model, year±1, fuelType)
 */
function groupByAttributes(listings: CarListing[]): FuzzyCandidates[] {
  const groups = new Map<string, FuzzyCandidates>();

  for (const listing of listings) {
    if (!listing.make || !listing.model) continue;

    // Year±1 grouping: if year is missing, use broader groups
    const year = listing.year ?? 0;
    const yearKey = year === 0 ? "unknown" : `${year - 1}_${year}_${year + 1}`;
    const fuelType = listing.fuelType ?? "UNKNOWN";

    const key = `${listing.make.toUpperCase()}|${listing.model.toUpperCase()}|${yearKey}|${fuelType}`;

    if (!groups.has(key)) {
      groups.set(key, {
        make: listing.make,
        model: listing.model,
        year,
        fuelType,
        listings: [],
      });
    }

    groups.get(key)!.listings.push(listing);
  }

  return Array.from(groups.values());
}

/**
 * Calculate similarity score between two listings (0-1).
 * Scoring factors:
 * - Mileage within 5%: +0.3
 * - Price within 10%: +0.3
 * - Same city: +0.2
 * - Different platform: +0.1
 * - Title similarity > 0.7: +0.1
 */
function calculateSimilarity(listingA: CarListing, listingB: CarListing): SimilarityScore {
  const factors: Record<string, number> = {};
  let totalScore = 0;

  // Mileage similarity (within 5%)
  if (listingA.mileage && listingB.mileage) {
    const mileageDiff = Math.abs(listingA.mileage - listingB.mileage);
    const mileagePercent =
      Math.abs(listingA.mileage - listingB.mileage) / Math.max(listingA.mileage, listingB.mileage);

    if (mileagePercent <= 0.05) {
      factors.mileage = 0.3;
      totalScore += 0.3;
    } else if (mileagePercent <= 0.15) {
      factors.mileage = 0.15;
      totalScore += 0.15;
    }
  }

  // Price similarity (within 10%)
  const pricePercent = Math.abs(listingA.price - listingB.price) / Math.max(listingA.price, listingB.price);
  if (pricePercent <= 0.1) {
    factors.price = 0.3;
    totalScore += 0.3;
  } else if (pricePercent <= 0.2) {
    factors.price = 0.15;
    totalScore += 0.15;
  }

  // Same city
  if (listingA.city && listingB.city && listingA.city.toLowerCase() === listingB.city.toLowerCase()) {
    factors.city = 0.2;
    totalScore += 0.2;
  }

  // Different platform (cross-platform duplicate = more likely real duplicate)
  if (listingA.source !== listingB.source) {
    factors.crossPlatform = 0.1;
    totalScore += 0.1;
  }

  // Title similarity (simple word overlap)
  const titleSimilarity = calculateTitleSimilarity(listingA.title, listingB.title);
  if (titleSimilarity > 0.7) {
    factors.titleSimilarity = 0.1;
    totalScore += 0.1;
  }

  return {
    listingA,
    listingB,
    score: Math.min(totalScore, 1.0), // Cap at 1.0
    factors,
  };
}

/**
 * Simple title similarity using word overlap (Jaccard-like).
 */
function calculateTitleSimilarity(titleA: string, titleB: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .sort();

  const wordsA = new Set(normalize(titleA));
  const wordsB = new Set(normalize(titleB));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = Array.from(wordsA).filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return intersection / union;
}

/**
 * Mark a listing as duplicate of another.
 */
async function markAsDuplicate(
  duplicate: CarListing,
  primary: CarListing,
  reason: "kenteken_duplicate" | "fuzzy_auto",
  score?: number
): Promise<void> {
  await prisma.carListing.update({
    where: { id: duplicate.id },
    data: {
      isActive: false,
      rawData: {
        ...((duplicate.rawData as Record<string, unknown>) || {}),
        deduplicationReason: reason,
        primaryListingId: primary.id,
        primarySource: primary.source,
        primaryPrice: primary.price,
        similarityScore: score,
        deduplicatedAt: new Date().toISOString(),
      },
    },
  });
}

/**
 * Log a potential duplicate for manual review (0.70-0.85 score).
 */
async function logPotentialDuplicate(listingA: CarListing, listingB: CarListing, score: number): Promise<void> {
  // Update rawData to flag as potential duplicate
  await prisma.carListing.update({
    where: { id: listingB.id },
    data: {
      rawData: {
        ...((listingB.rawData as Record<string, unknown>) || {}),
        potentialDuplicate: true,
        similarTo: listingA.id,
        similarityScore: score,
        flaggedAt: new Date().toISOString(),
      },
    },
  });
}

/**
 * Find cross-platform price spreads for the same car.
 * Useful for identifying arbitrage opportunities or data quality issues.
 */
async function findCrossPlatformSpreads(): Promise<
  DeduplicationStats["crossPlatformSpread"]
> {
  const spreads: DeduplicationStats["crossPlatformSpread"] = [];

  // Find cars with listings across multiple platforms
  const crossPlatformCars = await prisma.carListing.groupBy({
    by: ["make", "model", "year", "kenteken"],
    where: { isActive: true },
    _count: true,
  });

  for (const car of crossPlatformCars) {
    if (car._count < 2) continue;

    const listings = await prisma.carListing.findMany({
      where: {
        make: car.make,
        model: car.model,
        year: car.year,
        kenteken: car.kenteken,
        isActive: true,
      },
      select: {
        id: true,
        price: true,
        source: true,
      },
    });

    const sources = new Set(listings.map((l) => l.source));
    if (sources.size < 2) continue;

    const prices = listings.map((l) => l.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const spread = highestPrice - lowestPrice;

    if (spread > 0) {
      spreads.push({
        make: car.make,
        model: car.model,
        year: car.year ?? undefined,
        kenteken: car.kenteken ?? undefined,
        lowestPrice,
        highestPrice,
        spread,
        platforms: Array.from(sources).map((s) => s.toString()),
      });
    }
  }

  return spreads.sort((a, b) => b.spread - a.spread).slice(0, 100); // Top 100 spreads
}
