"use client"

import { useState, useEffect } from "react"
import { Loader2, LayoutGrid, List } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Pagination } from "@/components/shared/pagination"
import { DealCard } from "@/components/deals/DealCard"

interface MlPrediction {
  predictedP10: number
  predictedP50: number
  predictedP90: number
  suspicionFlag: boolean
  coverageLevel: number
  effectiveDealTier: string
}

interface Deal {
  id: string
  discountPercent: number
  discountEuros: number
  listingPrice: number
  averagePrice: number
  isAcknowledged: boolean
  createdAt: string
  dealTier: string | null
  dealScore: number | null
  confidence: number | null
  isMLGenerated: boolean
  mlPrediction: MlPrediction | null
  listing: {
    make: string
    model: string
    year: number | null
    mileage: number | null
    fuelType: string | null
    source: string
    url: string
    city: string | null
    imageUrls?: string[]
  }
}

const SOURCES = [
  { value: "All", label: "Alle bronnen" },
  { value: "AUTOSCOUT", label: "AutoScout" },
  { value: "MARKTPLAATS", label: "Marktplaats" },
  { value: "FACEBOOK", label: "Facebook" },
]

const DEAL_TIERS = [
  { value: "OUTSTANDING", label: "Uitstekend" },
  { value: "GREAT", label: "Goede deal" },
  { value: "FAIR", label: "Eerlijk" },
  { value: "HIGH", label: "Hoog" },
  { value: "OVERPRICED", label: "Te duur" },
]

const SORT_OPTIONS = [
  { value: "score", label: "Deal score" },
  { value: "confidence", label: "Betrouwbaarheid" },
  { value: "newest", label: "Nieuwste" },
  { value: "price", label: "Prijs" },
]

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [makeFilter, setMakeFilter] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [sourceFilter, setSourceFilter] = useState("All")
  const [dealTiersFilter, setDealTiersFilter] = useState<string[]>([])
  const [minConfidence, setMinConfidence] = useState(0)
  const [showUnacknowledged, setShowUnacknowledged] = useState(false)
  const [sortBy, setSortBy] = useState("score")
  const [viewMode, setViewMode] = useState<"card" | "list">("card")

  useEffect(() => {
    fetchDeals()
  }, [
    currentPage,
    makeFilter,
    modelFilter,
    sourceFilter,
    dealTiersFilter,
    minConfidence,
    showUnacknowledged,
    sortBy,
  ])

  async function fetchDeals() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "12",
        sort: sortBy,
        ...(makeFilter && { make: makeFilter }),
        ...(modelFilter && { model: modelFilter }),
        ...(sourceFilter !== "All" && { source: sourceFilter }),
        ...(dealTiersFilter.length > 0 && {
          dealTiers: dealTiersFilter.join(","),
        }),
        ...(minConfidence > 0 && { minConfidence: minConfidence.toString() }),
        ...(showUnacknowledged && { acknowledged: "false" }),
      })

      const res = await fetch(`/api/deals?${params}`)
      if (!res.ok) throw new Error("Failed to fetch deals")

      const data = (await res.json()) as {
        data?: Deal[]
        totalPages?: number
      }
      setDeals(data.data || [])
      setTotalPages(data.totalPages || 1)
    } catch (error) {
      console.error(error)
      setDeals([])
    } finally {
      setLoading(false)
    }
  }

  const handleResetFilters = () => {
    setMakeFilter("")
    setModelFilter("")
    setSourceFilter("All")
    setDealTiersFilter([])
    setMinConfidence(0)
    setShowUnacknowledged(false)
    setSortBy("score")
    setCurrentPage(1)
  }

  const toggleDealTier = (tier: string) => {
    setDealTiersFilter((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]
    )
    setCurrentPage(1)
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Deals</h1>
        <p className="text-muted-foreground mt-2">
          ML-aangedreven zoeken naar de beste autokoopjes
        </p>
      </div>

      {/* Filter Bar */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Merk</label>
              <Input
                placeholder="bijv. BMW"
                value={makeFilter}
                onChange={(e) => {
                  setMakeFilter(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Model</label>
              <Input
                placeholder="bijv. 3 Serie"
                value={modelFilter}
                onChange={(e) => {
                  setModelFilter(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Bron</label>
              <Select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value)
                  setCurrentPage(1)
                }}
              >
                {SOURCES.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Sorteren</label>
              <Select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value)
                  setCurrentPage(1)
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Deal Tier Filter */}
          <div>
            <label className="block text-sm font-medium mb-3">Deal Tier</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {DEAL_TIERS.map((tier) => (
                <label
                  key={tier.value}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={dealTiersFilter.includes(tier.value)}
                    onChange={() => toggleDealTier(tier.value)}
                    className="rounded"
                  />
                  <span className="text-sm">{tier.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Confidence Slider & Toggle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-3">
                Min. Betrouwbaarheid: {minConfidence}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minConfidence}
                onChange={(e) => {
                  setMinConfidence(parseInt(e.target.value))
                  setCurrentPage(1)
                }}
                className="w-full"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showUnacknowledged}
                  onChange={(e) => {
                    setShowUnacknowledged(e.target.checked)
                    setCurrentPage(1)
                  }}
                />
                <span className="text-sm font-medium">Alleen nieuw</span>
              </label>
            </div>
          </div>

          {/* Reset Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetFilters}
          >
            Filters wissen
          </Button>
        </CardContent>
      </Card>

      {/* Deals Grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? "Laden..." : `${deals.length} deals`}
          </p>
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <button
              onClick={() => setViewMode("card")}
              className={`p-1.5 rounded ${viewMode === "card" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
              title="Kaartweergave"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded ${viewMode === "list" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
              title="Lijstweergave"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : deals.length > 0 ? (
          <>
            <div className={`grid grid-cols-1 ${viewMode === "list" ? "gap-2" : "gap-4"} mb-8`}>
              {deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  {...deal}
                  viewMode={viewMode}
                />
              ))}
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-muted-foreground">
                Geen deals gevonden met deze filters.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
