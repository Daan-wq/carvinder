export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source, DealTier } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  make: z.string().optional(),
  model: z.string().optional(),
  source: z.enum([Source.MARKTPLAATS, Source.AUTOSCOUT, Source.FACEBOOK, Source.AUCTION, Source.OTHER]).optional(),
  acknowledged: z.enum(["true", "false"]).transform(v => v === "true").optional(),
  dealTiers: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(["score", "confidence", "newest", "price"]).default("score"),
});

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

    const { page, limit, make, model, source, acknowledged, dealTiers, minConfidence, sort } = parsed.data;
    const skip = (page - 1) * limit;

    const listingWhere: Record<string, unknown> = {};
    if (make) listingWhere.make = { contains: make, mode: "insensitive" };
    if (model) listingWhere.model = { contains: model, mode: "insensitive" };
    if (source) listingWhere.source = source;

    const where: Record<string, unknown> = {};
    if (Object.keys(listingWhere).length > 0) where.listing = listingWhere;
    if (acknowledged !== undefined) where.isAcknowledged = acknowledged;

    // Deal tier filter (comma-separated values from UI)
    if (dealTiers) {
      const tiers = dealTiers.split(",").filter(t => Object.values(DealTier).includes(t as DealTier));
      if (tiers.length > 0) where.dealTier = { in: tiers as DealTier[] };
    }

    // Confidence filter (stored as 0-1 float, UI sends 0-100)
    if (minConfidence !== undefined && minConfidence > 0) {
      where.confidence = { gte: minConfidence / 100 };
    }

    const orderBy = (() => {
      switch (sort) {
        case "score":      return [{ dealScore: "desc" as const }, { createdAt: "desc" as const }];
        case "confidence": return [{ confidence: "desc" as const }, { createdAt: "desc" as const }];
        case "price":      return [{ listingPrice: "asc" as const }, { createdAt: "desc" as const }];
        default:           return [{ createdAt: "desc" as const }];
      }
    })();

    const [deals, total] = await Promise.all([
      prisma.dealAlert.findMany({
        where,
        include: {
          listing: {
            select: {
              make: true, model: true, year: true, mileage: true,
              fuelType: true, source: true, url: true, city: true,
              imageUrls: true,
            },
          },
          mlPrediction: {
            select: {
              predictedP10: true, predictedP50: true, predictedP90: true,
              dealScore: true, dealTier: true, overallConfidence: true,
              suspicionFlag: true, coverageLevel: true, effectiveDealTier: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.dealAlert.count({ where }),
    ]);

    return NextResponse.json({
      data: deals,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}
