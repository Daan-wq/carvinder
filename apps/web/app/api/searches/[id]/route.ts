export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Source } from "@autarb/db";

const paramsSchema = z.object({
  id: z.string().cuid(),
});

const updateSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().optional(),
  yearMin: z.number().int().optional(),
  yearMax: z.number().int().optional(),
  mileageMax: z.number().int().optional(),
  maxPrice: z.number().int().optional(),
  alertThresholdPercent: z.number().int().min(1).optional(),
  sources: z.array(z.enum([Source.MARKTPLAATS, Source.AUTOSCOUT, Source.FACEBOOK, Source.AUCTION, Source.OTHER])).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paramsParsed = paramsSchema.safeParse(params);

    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Invalid search ID" }, { status: 400 });
    }

    const body = await request.json();
    const bodyParsed = updateSchema.safeParse(body);

    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: bodyParsed.error.flatten() },
        { status: 400 }
      );
    }

    const search = await prisma.watchedSearch.findUnique({
      where: { id: paramsParsed.data.id },
    });

    if (!search) {
      return NextResponse.json({ error: "Search not found" }, { status: 404 });
    }

    const updated = await prisma.watchedSearch.update({
      where: { id: paramsParsed.data.id },
      data: bodyParsed.data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating search:", error);
    return NextResponse.json({ error: "Failed to update search" }, { status: 500 });
  }
}
