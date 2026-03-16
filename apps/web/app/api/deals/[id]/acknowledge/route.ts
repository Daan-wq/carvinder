export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@autarb/db";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().cuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsed = paramsSchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid deal ID" }, { status: 400 });
    }

    const deal = await prisma.dealAlert.findUnique({
      where: { id: parsed.data.id },
      include: { listing: true, profile: true },
    });

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const updated = await prisma.dealAlert.update({
      where: { id: parsed.data.id },
      data: { isAcknowledged: true },
      include: { listing: true, profile: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error acknowledging deal:", error);
    return NextResponse.json({ error: "Failed to acknowledge deal" }, { status: 500 });
  }
}
