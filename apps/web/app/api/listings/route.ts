export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source } from "@autarb/db";

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

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: listings,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching listings:", error);
    return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}
