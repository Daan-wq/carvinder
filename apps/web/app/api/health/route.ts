export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@autarb/db";

export async function GET(request: NextRequest) {
  try {
    const [creditUsage, lastScrapes] = await Promise.all([
      prisma.creditUsage.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.scrapeJob.groupBy({
        by: ["source"],
        _max: { completedAt: true },
        orderBy: { source: "asc" },
      }),
    ]);

    const lastScrapesBySource = await Promise.all(
      lastScrapes.map(async (item) => {
        const job = await prisma.scrapeJob.findFirst({
          where: { source: item.source },
          orderBy: { completedAt: "desc" },
          take: 1,
        });
        return {
          source: item.source,
          lastRun: job?.completedAt || null,
          status: job?.status || "UNKNOWN",
          durationMs: job?.durationMs || null,
        };
      })
    );

    const status = {
      database: "healthy",
      creditUsage: {
        used: creditUsage?.creditsUsed || 0,
        limit: creditUsage?.creditLimit || 500,
        remaining: (creditUsage?.creditLimit || 500) - (creditUsage?.creditsUsed || 0),
      },
      lastScrapeBySource: lastScrapesBySource,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(status);
  } catch (error) {
    console.error("Error checking health:", error);
    return NextResponse.json(
      { error: "Service unhealthy", database: "unhealthy" },
      { status: 503 }
    );
  }
}
