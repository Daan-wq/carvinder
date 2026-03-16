export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  make: z.string().optional(),
  model: z.string().optional(),
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

    const { page, limit, make, model } = parsed.data;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (make) where.make = make;
    if (model) where.model = model;

    const [profiles, total] = await Promise.all([
      prisma.priceProfile.findMany({
        where,
        orderBy: [{ make: "asc" }, { model: "asc" }],
        skip,
        take: limit,
      }),
      prisma.priceProfile.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: profiles,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching price profiles:", error);
    return NextResponse.json({ error: "Failed to fetch price profiles" }, { status: 500 });
  }
}
