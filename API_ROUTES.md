# AutoArb API Routes Documentation

## Overview

Complete REST API for the AutoArb car scraper dashboard. All endpoints use Next.js App Router and Prisma ORM.

## Base Configuration

- **Framework**: Next.js 15+ with App Router
- **Database**: PostgreSQL via Prisma
- **Validation**: Zod
- **Error Handling**: Centralized try/catch with proper HTTP status codes
- **Authentication**: CRON_SECRET for scraper trigger

## Endpoint Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/deals` | GET | List paginated deal alerts |
| `/api/deals/[id]/acknowledge` | POST | Mark deal as seen |
| `/api/prices` | GET | List price profiles |
| `/api/listings` | GET | List car listings with filters |
| `/api/searches` | GET, POST | Get watched searches or create new |
| `/api/searches/[id]` | PUT | Update watched search |
| `/api/stats` | GET | Dashboard statistics |
| `/api/health` | GET | System health check |
| `/api/notifications` | GET | Notification log |
| `/api/scrape/trigger` | POST | Manual scrape trigger |

## Detailed Endpoints

### GET /api/deals

Retrieve paginated list of deal alerts with filtering and relations.

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20, max: 100)
make: string (optional)
model: string (optional)
source: "MARKTPLAATS" | "AUTOSCOUT" | "FACEBOOK" | "AUCTION" | "OTHER" (optional)
acknowledged: "true" | "false" (optional)
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cuid",
      "listingId": "cuid",
      "profileId": "cuid",
      "listing": { /* CarListing */ },
      "profile": { /* PriceProfile */ },
      "listingPrice": 15000,
      "averagePrice": 18000,
      "discountPercent": 16.7,
      "discountEuros": 3000,
      "isAcknowledged": false,
      "createdAt": "2026-03-16T21:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "totalPages": 3
}
```

**Errors:**
- 400: Invalid query parameters
- 500: Database error

---

### POST /api/deals/[id]/acknowledge

Mark a deal alert as acknowledged/seen.

**URL Parameters:**
```
id: string (cuid format, required)
```

**Response (200):**
```json
{
  "id": "cuid",
  "isAcknowledged": true,
  "listing": { /* CarListing */ },
  "profile": { /* PriceProfile */ },
  /* ... other fields */
}
```

**Errors:**
- 400: Invalid deal ID format
- 404: Deal not found
- 500: Database error

---

### GET /api/prices

Retrieve paginated price profiles for market analysis.

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20, max: 100)
make: string (optional)
model: string (optional)
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cuid",
      "make": "BMW",
      "model": "3 Series",
      "yearBucketStart": 2020,
      "yearBucketEnd": 2022,
      "mileageBucket": "KM_100_150K",
      "fuelType": "DIESEL",
      "condition": "USED_GOOD",
      "sampleCount": 45,
      "averagePrice": 22000,
      "medianPrice": 21500,
      "p10Price": 18000,
      "p90Price": 26000,
      "lastCalculatedAt": "2026-03-16T20:00:00Z"
    }
  ],
  "total": 156,
  "page": 1,
  "totalPages": 8
}
```

**Errors:**
- 400: Invalid query parameters
- 500: Database error

---

### GET /api/listings

Retrieve paginated car listings with comprehensive filtering.

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20, max: 100)
source: enum (optional)
make: string (optional)
model: string (optional)
yearMin: number (optional)
yearMax: number (optional)
priceMin: number (optional)
priceMax: number (optional)
mileageMax: number (optional)
isActive: "true" | "false" (optional)
```

**Example:**
```
GET /api/listings?make=BMW&model=3%20Series&yearMin=2020&priceMax=25000&limit=50
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cuid",
      "source": "MARKTPLAATS",
      "externalId": "12345",
      "url": "https://...",
      "make": "BMW",
      "model": "3 Series",
      "year": 2021,
      "mileage": 85000,
      "price": 22500,
      "title": "BMW 3 Series 320d",
      "isActive": true,
      "lastSeenAt": "2026-03-16T21:00:00Z"
    }
  ],
  "total": 234,
  "page": 1,
  "totalPages": 12
}
```

**Errors:**
- 400: Invalid query parameters
- 500: Database error

---

### GET /api/searches

Retrieve all watched searches (paginated).

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20, max: 100)
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cuid",
      "make": "BMW",
      "model": "3 Series",
      "yearMin": 2020,
      "yearMax": 2023,
      "mileageMax": 150000,
      "maxPrice": 30000,
      "alertThresholdPercent": 15,
      "sources": ["MARKTPLAATS", "AUTOSCOUT"],
      "isActive": true,
      "lastScrapedAt": "2026-03-16T20:30:00Z",
      "createdAt": "2026-01-10T12:00:00Z",
      "updatedAt": "2026-03-15T14:00:00Z"
    }
  ],
  "total": 8,
  "page": 1,
  "totalPages": 1
}
```

---

### POST /api/searches

Create a new watched search.

**Request Body:**
```json
{
  "make": "BMW",
  "model": "3 Series",
  "yearMin": 2020,
  "yearMax": 2023,
  "mileageMax": 150000,
  "maxPrice": 30000,
  "alertThresholdPercent": 15,
  "sources": ["MARKTPLAATS", "AUTOSCOUT"]
}
```

**Field Validation:**
- `make`: string, required, min 1 char
- `model`: string, optional
- `yearMin`, `yearMax`: number, optional
- `mileageMax`: number, optional
- `maxPrice`: number, optional
- `alertThresholdPercent`: number, default 15, min 1
- `sources`: array of Source enum, required, min 1 item

**Response (201):**
```json
{
  "id": "cuid",
  "make": "BMW",
  "model": "3 Series",
  "sources": ["MARKTPLAATS", "AUTOSCOUT"],
  "isActive": true,
  "createdAt": "2026-03-16T21:15:00Z",
  "updatedAt": "2026-03-16T21:15:00Z"
}
```

**Errors:**
- 400: Invalid request body
- 500: Database error

---

### PUT /api/searches/[id]

Update an existing watched search.

**URL Parameters:**
```
id: string (cuid format, required)
```

**Request Body (all fields optional):**
```json
{
  "make": "Mercedes",
  "model": "C-Class",
  "yearMin": 2021,
  "yearMax": 2024,
  "mileageMax": 100000,
  "maxPrice": 35000,
  "alertThresholdPercent": 20,
  "sources": ["MARKTPLAATS", "AUTOSCOUT", "FACEBOOK"],
  "isActive": false
}
```

**Response (200):**
```json
{
  "id": "cuid",
  "make": "Mercedes",
  "model": "C-Class",
  "isActive": false,
  "updatedAt": "2026-03-16T21:20:00Z"
}
```

**Errors:**
- 400: Invalid ID or request body
- 404: Search not found
- 500: Database error

---

### GET /api/stats

Get dashboard summary statistics.

**Response (200):**
```json
{
  "totalListings": 5432,
  "activeProfiles": 234,
  "unacknowledgedDeals": 12,
  "creditUsage": {
    "used": 350,
    "limit": 500
  },
  "lastScrapeBySource": [
    {
      "source": "MARKTPLAATS",
      "lastRun": "2026-03-16T21:00:00Z",
      "status": "DONE"
    },
    {
      "source": "AUTOSCOUT",
      "lastRun": "2026-03-16T20:55:00Z",
      "status": "DONE"
    }
  ]
}
```

**Errors:**
- 500: Database error

---

### GET /api/health

Check system health and resource usage.

**Response (200):**
```json
{
  "database": "healthy",
  "creditUsage": {
    "used": 350,
    "limit": 500,
    "remaining": 150
  },
  "lastScrapeBySource": [
    {
      "source": "MARKTPLAATS",
      "lastRun": "2026-03-16T21:00:00Z",
      "status": "DONE",
      "durationMs": 45000
    }
  ],
  "timestamp": "2026-03-16T21:25:00Z"
}
```

**Errors:**
- 503: Service unavailable (database error)

---

### GET /api/notifications

Retrieve paginated notification log.

**Query Parameters:**
```
page: number (default: 1)
limit: number (default: 20, max: 100)
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "cuid",
      "type": "DEAL_ALERT",
      "dealCount": 3,
      "message": "Found 3 deals matching your search",
      "success": true,
      "sentAt": "2026-03-16T21:00:00Z"
    }
  ],
  "total": 156,
  "page": 1,
  "totalPages": 8
}
```

**Errors:**
- 400: Invalid query parameters
- 500: Database error

---

### POST /api/scrape/trigger

Manually trigger a scrape job via CRON_SECRET authentication.

**Headers:**
```
x-cron-secret: string (required, must match CRON_SECRET env var)
```

**Environment Variables Required:**
- `CRON_SECRET`: Secret for authentication
- `WORKER_URL`: Base URL of worker service (e.g., http://localhost:3001)

**Response (202):**
```json
{
  "message": "Scrape triggered successfully"
}
```

**Errors:**
- 401: Missing or invalid CRON_SECRET
- 500: Configuration error (missing WORKER_URL or CRON_SECRET) or worker request failed

---

## Common Query Patterns

### Get unacknowledged deals for BMW 3-series
```
GET /api/deals?make=BMW&model=3%20Series&acknowledged=false
```

### Get listings under €25k from last 30 days
```
GET /api/listings?priceMax=25000&isActive=true
```

### Find deals from most expensive source
```
GET /api/listings?source=FACEBOOK&limit=50
```

### Search for Audi A4 2020-2022
```
GET /api/listings?make=Audi&model=A4&yearMin=2020&yearMax=2022
```

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human-readable error message",
  "details": {
    /* Zod validation details if applicable */
  }
}
```

### HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful GET/PUT |
| 201 | Created | Successful POST |
| 202 | Accepted | Async scrape triggered |
| 400 | Bad Request | Invalid input/validation failure |
| 401 | Unauthorized | Invalid CRON_SECRET |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Database or unexpected error |
| 503 | Service Unavailable | Health check failed |

## Performance Considerations

- All pagination endpoints default to limit=20
- Maximum limit enforced at 100 per page
- Related data (listing, profile) included via Prisma relations
- Stats endpoints use `Promise.all()` for parallel queries
- No N+1 queries (all includes specified)

## Security

- All inputs validated with Zod schemas
- Parameterized queries via Prisma (SQL injection prevention)
- CRON_SECRET required for scrape trigger
- Environment variables for sensitive config
- Error messages safe for client consumption
- No internal stack traces exposed to clients

## File Locations

All routes are in: `apps/web/app/api/`

```
app/api/
├── deals/
│   ├── route.ts (GET)
│   └── [id]/
│       └── acknowledge/
│           └── route.ts (POST)
├── prices/
│   └── route.ts (GET)
├── listings/
│   └── route.ts (GET)
├── searches/
│   ├── route.ts (GET, POST)
│   └── [id]/
│       └── route.ts (PUT)
├── stats/
│   └── route.ts (GET)
├── health/
│   └── route.ts (GET)
├── notifications/
│   └── route.ts (GET)
└── scrape/
    └── trigger/
        └── route.ts (POST)
```
