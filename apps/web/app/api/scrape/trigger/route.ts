export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.error("CRON_SECRET environment variable not set");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    if (!cronSecret || cronSecret !== expectedSecret) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const workerUrl = process.env.WORKER_URL;

    if (!workerUrl) {
      console.error("WORKER_URL environment variable not set");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(`${workerUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${expectedSecret}`,
      },
    });

    if (!response.ok) {
      console.error(`Worker returned ${response.status}`);
      return NextResponse.json(
        { error: "Worker request failed" },
        { status: response.status }
      );
    }

    return NextResponse.json(
      { message: "Scrape triggered successfully" },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error triggering scrape:", error);
    return NextResponse.json(
      { error: "Failed to trigger scrape" },
      { status: 500 }
    );
  }
}
