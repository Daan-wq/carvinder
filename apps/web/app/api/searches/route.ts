export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  make: z.string().min(1),
  model: z.string().optional(),
  yearMin: z.number().int().optional(),
  yearMax: z.number().int().optional(),
  mileageMax: z.number().int().optional(),
  maxPrice: z.number().int().optional(),
  alertThresholdPercent: z.number().int().min(1).default(15),
  sources: z.array(z.enum([Source.MARKTPLAATS, Source.AUTOSCOUT, Source.FACEBOOK, Source.AUCTION, Source.OTHER])).min(1),
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

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const [searches, total] = await Promise.all([
      prisma.watchedSearch.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.watchedSearch.count(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: searches,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching searches:", error);
    return NextResponse.json({ error: "Failed to fetch searches" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const search = await prisma.watchedSearch.create({
      data: parsed.data,
    });

    return NextResponse.json(search, { status: 201 });
  } catch (error) {
    console.error("Error creating search:", error);
    return NextResponse.json({ error: "Failed to create search" }, { status: 500 });
  }
}
