export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@autarb/db";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

    const [notifications, total] = await Promise.all([
      prisma.notificationLog.findMany({
        orderBy: { sentAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.notificationLog.count(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      data: notifications,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}
