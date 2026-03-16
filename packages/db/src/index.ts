import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export type {
  CarListing,
  CarListingPriceHistory,
  PriceProfile,
  DealAlert,
  WatchedSearch,
  ScrapeJob,
  CreditUsage,
  NotificationLog,
} from "@prisma/client";

export {
  Source,
  Condition,
  FuelType,
  Transmission,
  MileageBucket,
  ScrapeJobStatus,
} from "@prisma/client";
