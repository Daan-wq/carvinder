export const dynamic = "force-dynamic"

import { prisma, DealTier } from "@autarb/db"

const EMPTY_TIERS = { OUTSTANDING: 0, GREAT: 0, FAIR: 0, HIGH: 0, OVERPRICED: 0 }

export async function GET() {
  try {
    const mlServiceUrl = process.env.ML_SERVICE_URL || "http://localhost:8000"

    // Fetch ML health + deal tier counts from DB in parallel
    const [mlData, tierRows] = await Promise.all([
      fetch(`${mlServiceUrl}/health`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null) as Promise<{
          status?: string; model_version?: string; last_training_date?: string
        } | null>,

      prisma.dealAlert.groupBy({
        by: ["dealTier"],
        _count: { _all: true },
        where: { dealTier: { not: null } },
      }).catch(() => []),
    ])

    const dealsByTier = { ...EMPTY_TIERS }
    for (const row of tierRows) {
      if (row.dealTier && row.dealTier in dealsByTier) {
        dealsByTier[row.dealTier as keyof typeof EMPTY_TIERS] = row._count._all
      }
    }

    if (!mlData) {
      return Response.json({ available: false, version: null, lastTrainingDate: null, dealsByTier })
    }

    return Response.json({
      available: true,
      version: mlData.model_version ?? null,
      lastTrainingDate: mlData.last_training_date ?? null,
      dealsByTier,
    })
  } catch (error) {
    console.error("ML status error:", error)
    return Response.json({ available: false, version: null, lastTrainingDate: null, dealsByTier: EMPTY_TIERS })
  }
}
