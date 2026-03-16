import { MileageBucket } from "@autarb/db";

export interface YearBucket {
  start: number;
  end: number;
}

export function getYearBucket(year: number): YearBucket {
  const bucketStart = Math.floor(year / 2) * 2;
  return {
    start: bucketStart,
    end: bucketStart + 1,
  };
}

export function getMileageBucket(km: number): MileageBucket {
  if (km < 50000) return MileageBucket.KM_0_50K;
  if (km < 100000) return MileageBucket.KM_50_100K;
  if (km < 150000) return MileageBucket.KM_100_150K;
  if (km < 200000) return MileageBucket.KM_150_200K;
  return MileageBucket.KM_200K_PLUS;
}
