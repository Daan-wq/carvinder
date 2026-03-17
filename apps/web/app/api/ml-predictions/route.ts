export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const page = url.searchParams.get("page") || "1"
    const limit = url.searchParams.get("limit") || "20"
    const dealTier = url.searchParams.get("dealTier")
    const minConfidence = url.searchParams.get("minConfidence")

    const query = new URLSearchParams({
      page,
      limit,
      ...(dealTier && { deal_tier: dealTier }),
      ...(minConfidence && { min_confidence: minConfidence }),
    })

    const response = await fetch(
      `http://localhost:5432/api/ml-predictions?${query}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    )

    if (!response.ok) {
      return Response.json(
        { error: "Failed to fetch ML predictions" },
        { status: response.status }
      )
    }

    const data = await response.json()

    return Response.json({
      data: data.data || [],
      totalPages: data.total_pages || 1,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  } catch (error) {
    console.error("ML predictions error:", error)

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
