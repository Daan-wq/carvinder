export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@autarb/db";

export async function GET(request: NextRequest) {
  try {
    const [
      totalListings,
      activeProfiles,
      unacknowledgedDeals,
      creditUsage,
      lastScrapeBySource,
    ] = await Promise.all([
      prisma.carListing.count(),
      prisma.priceProfile.count(),
      prisma.dealAlert.count({ where: { isAcknowledged: false } }),
      prisma.creditUsage.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.scrapeJob.groupBy({
        by: ["source"],
        _max: { completedAt: true },
        orderBy: { source: "asc" },
      }),
    ]);

    const lastScrapeDetails = await Promise.all(
      lastScrapeBySource.map(async (item) => {
        const job = await prisma.scrapeJob.findFirst({
          where: { source: item.source },
          orderBy: { completedAt: "desc" },
          take: 1,
        });
        return {
          source: item.source,
          lastRun: job?.completedAt || null,
          status: job?.status || "UNKNOWN",
        };
      })
    );

    return NextResponse.json({
      totalListings,
      activeProfiles,
      unacknowledgedDeals,
      creditUsage: {
        used: creditUsage?.creditsUsed || 0,
        limit: creditUsage?.creditLimit || 500,
      },
      lastScrapeBySource: lastScrapeDetails,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
