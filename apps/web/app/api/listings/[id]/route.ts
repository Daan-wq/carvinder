import { NextResponse } from "next/server"

interface RouteParams {
  params: {
    id: string
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = params

    if (!id) {
      return NextResponse.json(
        { error: "Listing ID is required" },
        { status: 400 }
      )
    }

    // Fetch from your API/database
    // This is a proxy to your backend API
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"

    const response = await fetch(`${backendUrl}/api/listings/${id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Listing not found" },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: "Failed to fetch listing" },
        { status: response.status }
      )
    }

    const listing = await response.json()

    return NextResponse.json(listing)
  } catch (error) {
    console.error("Listing fetch error:", error)

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
