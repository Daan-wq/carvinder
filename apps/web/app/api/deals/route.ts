export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  make: z.string().optional(),
  model: z.string().optional(),
  source: z.enum([Source.MARKTPLAATS, Source.AUTOSCOUT, Source.FACEBOOK, Source.AUCTION, Source.OTHER]).optional(),
  acknowledged: z.enum(["true", "false"]).transform(v => v === "true").optional(),
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

    const { page, limit, make, model, source, acknowledged } = parsed.data;
    const skip = (page - 1) * limit;

    const listingWhere: any = {};
    if (make) listingWhere.make = make;
    if (model) listingWhere.model = model;
    if (source) listingWhere.source = source;

    const where: any = {};
    if (Object.keys(listingWhere).length > 0) where.listing = listingWhere;
    if (acknowledged !== undefined) where.isAcknowledged = acknowledged;

    const [deals, total] = await Promise.all([
      prisma.dealAlert.findMany({
        where,
        include: { listing: true, profile: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.dealAlert.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: deals,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}
