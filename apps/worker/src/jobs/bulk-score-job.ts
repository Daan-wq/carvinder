import { prisma } from "@autarb/db";
import { detectDealsML } from "./ml-deal-detector";

const BATCH_SIZE = 500;

export interface BulkScoreProgress {
  processed: number;
  deals: number;
  total: number;
  done: boolean;
  errorCount: number;
}

let _progress: BulkScoreProgress = { processed: 0, deals: 0, total: 0, done: false, errorCount: 0 };
let _running = false;

export function getBulkScoreStatus(): { running: boolean; progress: BulkScoreProgress } {
  return { running: _running, progress: _progress };
}

export async function runBulkScoreJob(): Promise<BulkScoreProgress> {
  if (_running) return _progress;

  _running = true;
  _progress = { processed: 0, deals: 0, total: 0, done: false, errorCount: 0 };

  try {
    _progress.total = await prisma.carListing.count({
      where: { isActive: true, mlPrediction: null },
    });

    console.log(`[bulk-score] Starting — ${_progress.total} unscored listings`);

    let cursor: string | undefined = undefined;

    while (true) {
      const cursorArg = cursor ? { cursor: { id: cursor }, skip: 1 as const } : {};
      const listings: Array<{ id: string }> = await prisma.carListing.findMany({
        where: { isActive: true, mlPrediction: null },
        select: { id: true },
        take: BATCH_SIZE,
        ...cursorArg,
        orderBy: { id: "asc" },
      });

      if (listings.length === 0) break;

      cursor = listings[listings.length - 1].id;
      const ids = listings.map((l: { id: string }) => l.id);

      try {
        const deals = await detectDealsML(ids);
        _progress.deals += deals.length;
      } catch (e) {
        console.error(`[bulk-score] Batch error:`, e);
        _progress.errorCount += ids.length;
      }

      _progress.processed += ids.length;
      console.log(
        `[bulk-score] ${_progress.processed}/${_progress.total} processed, ${_progress.deals} deals, ${_progress.errorCount} errors`
      );
    }

    _progress.done = true;
    console.log(`[bulk-score] Complete — ${_progress.deals} deal alerts created`);
  } finally {
    _running = false;
  }

  return _progress;
}
