"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Zap, DollarSign, BarChart3 } from "lucide-react"

function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value)
}

function formatDate(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (hours < 1) return "Just now"
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString("nl-NL")
}

interface Stats {
  totalListings: number
  activeProfiles: number
  unacknowledgedDeals: number
  creditUsage: { used: number; limit: number }
  lastScrapeBySource: Array<{ source: string; lastRun: string; status: string }>
}

interface Deal {
  id: string
  listingPrice: number
  averagePrice: number
  discountPercent: number
  discountEuros: number
  createdAt: string
  isAcknowledged: boolean
  listing: {
    make: string
    model: string
    year: number | null
    mileage: number | null
    source: string
    url: string
    city: string | null
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then(r => r.json()).catch(() => null),
      fetch("/api/deals?limit=10").then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([statsData, dealsData]) => {
      setStats(statsData)
      setDeals(dealsData?.data ?? [])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-6 max-w-7xl">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const creditRemaining = stats ? stats.creditUsage.limit - stats.creditUsage.used : 0

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Car price arbitrage overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Listings</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalListings ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all sources</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Price Profiles</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeProfiles ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Active market benchmarks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Deals</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.unacknowledgedDeals ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Unacknowledged</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Firecrawl Credits</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{creditRemaining}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.creditUsage.used ?? 0} / {stats?.creditUsage.limit ?? 500} used
            </p>
          </CardContent>
        </Card>
      </div>

      {stats?.lastScrapeBySource && stats.lastScrapeBySource.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Scraper Health</CardTitle>
            <CardDescription>Last run per source</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.lastScrapeBySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between">
                  <span className="font-medium">{s.source}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{formatDate(s.lastRun)}</span>
                    <Badge variant={s.status === "DONE" ? "default" : "destructive"}>
                      {s.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Deals</CardTitle>
          <CardDescription>Latest below-market listings</CardDescription>
        </CardHeader>
        <CardContent>
          {deals.length > 0 ? (
            <div className="space-y-4">
              {deals.map((deal) => (
                <div key={deal.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div>
                    <div className="font-medium">
                      {deal.listing.make} {deal.listing.model}
                      {deal.listing.year && ` (${deal.listing.year})`}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {deal.listing.city && `${deal.listing.city} · `}
                      {deal.listing.source} · {formatDate(deal.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-green-600">
                      -{Math.round(deal.discountPercent)}% ({formatPrice(deal.discountEuros)} saving)
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatPrice(deal.listingPrice)} vs avg {formatPrice(deal.averagePrice)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No deals yet. Scraper will find them!
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
