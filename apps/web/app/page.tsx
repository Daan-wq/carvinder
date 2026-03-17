"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Zap, TrendingUp, BarChart3, Activity } from "lucide-react"

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
  lastScrapeBySource: Array<{ source: string; lastRun: string; status: string }>
}

interface MlStatus {
  available: boolean
  version: string | null
  lastTrainingDate: string | null
}

interface DealsByTier {
  OUTSTANDING: number
  GREAT: number
  FAIR: number
  HIGH: number
  OVERPRICED: number
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
  const [mlStatus, setMlStatus] = useState<MlStatus | null>(null)
  const [dealsByTier, setDealsByTier] = useState<DealsByTier | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then(r => r.json()).catch(() => null),
      fetch("/api/deals?limit=10").then(r => r.json()).catch(() => ({ data: [] })),
      fetch("/api/ml-status").then(r => r.json()).catch(() => null),
    ]).then(([statsData, dealsData, mlData]) => {
      setStats(statsData)
      setDeals(dealsData?.data ?? [])
      setMlStatus(mlData)
      if (mlData && mlData.dealsByTier) {
        setDealsByTier(mlData.dealsByTier)
      }
    }).finally(() => setLoading(false))
  }, [])

  function formatSource(source: string): string {
    const map: Record<string, string> = {
      AUTOSCOUT: "AutoScout", MARKTPLAATS: "Marktplaats",
      FACEBOOK: "Facebook", AUCTION: "Veiling", OTHER: "Overig",
    }
    return map[source] || source
  }

  function formatStatus(status: string): string {
    const map: Record<string, string> = { DONE: "Klaar", RUNNING: "Bezig", FAILED: "Mislukt", PENDING: "Wachtrij" }
    return map[status] || status
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Overzicht auto-arbitrage</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Advertenties</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.totalListings ?? 0).toLocaleString("nl-NL")}</div>
            <p className="text-xs text-muted-foreground mt-1">Alle bronnen samen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Marktprofielen</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.activeProfiles ?? 0).toLocaleString("nl-NL")}</div>
            <p className="text-xs text-muted-foreground mt-1">Gemiddelde marktprijzen per type</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nieuwe deals</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.unacknowledgedDeals ?? 0).toLocaleString("nl-NL")}</div>
            <p className="text-xs text-muted-foreground mt-1">Nog niet bekeken</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wat is een deal?</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">≥ 15%</div>
            <p className="text-xs text-muted-foreground mt-1">Onder marktgemiddelde = koopje</p>
          </CardContent>
        </Card>
      </div>

      {mlStatus && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ML Service Status</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${mlStatus.available ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <div>
                  <div className="font-medium">{mlStatus.available ? 'Beschikbaar' : 'Niet beschikbaar'}</div>
                  {mlStatus.version && (
                    <p className="text-xs text-muted-foreground">v{mlStatus.version}</p>
                  )}
                  {mlStatus.lastTrainingDate && (
                    <p className="text-xs text-muted-foreground mt-1">Training: {formatDate(mlStatus.lastTrainingDate)}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {dealsByTier && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Deal Pipeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-600 font-medium">Uitstekend</span>
                    <span className="font-bold">{dealsByTier.OUTSTANDING}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-500 font-medium">Goede deal</span>
                    <span className="font-bold">{dealsByTier.GREAT}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 font-medium">Eerlijk</span>
                    <span className="font-bold">{dealsByTier.FAIR}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-orange-600 font-medium">Hoog</span>
                    <span className="font-bold">{dealsByTier.HIGH}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-red-600 font-medium">Te duur</span>
                    <span className="font-bold">{dealsByTier.OVERPRICED}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {stats?.lastScrapeBySource && stats.lastScrapeBySource.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Scraper status</CardTitle>
            <CardDescription>Laatste run per bron</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.lastScrapeBySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between">
                  <span className="font-medium">{formatSource(s.source)}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{formatDate(s.lastRun)}</span>
                    <Badge variant={s.status === "DONE" ? "default" : "destructive"}>
                      {formatStatus(s.status)}
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
          <CardTitle>Recente deals</CardTitle>
          <CardDescription>Nieuwste advertenties onder de marktprijs</CardDescription>
        </CardHeader>
        <CardContent>
          {deals.length > 0 ? (
            <div className="space-y-4">
              {deals.map((deal) => (
                <a key={deal.id} href={deal.listing.url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between border-b pb-3 last:border-0 hover:bg-muted/40 rounded px-1 -mx-1 transition-colors">
                  <div>
                    <div className="font-medium">
                      {deal.listing.make} {deal.listing.model}
                      {deal.listing.year && ` (${deal.listing.year})`}
                      {deal.listing.mileage && <span className="text-muted-foreground font-normal"> · {deal.listing.mileage.toLocaleString("nl-NL")} km</span>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {deal.listing.city && `${deal.listing.city} · `}
                      {formatSource(deal.listing.source)} · {formatDate(deal.createdAt)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="font-bold text-green-600">
                      -{Math.round(deal.discountPercent)}% · {formatPrice(deal.discountEuros)} goedkoper
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatPrice(deal.listingPrice)} vs markt {formatPrice(deal.averagePrice)}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Nog geen deals gevonden. De scraper zoekt automatisch.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
