"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, ExternalLink } from "lucide-react"
import { Pagination } from "@/components/shared/pagination"

interface Listing {
  id: string
  source: "AUTOSCOUT" | "MARKTPLAATS" | string
  url: string
  make: string
  model: string
  year: number | null
  mileage: number | null
  fuelType: string | null
  transmission: string | null
  price: number
  title: string
  city: string | null
  imageUrls: string[]
  lastSeenAt: string
  marketValue: number | null
  discountPercent: number | null
  savings: number | null
  profileSampleCount: number | null
}

interface ListingsResponse {
  listings: Listing[]
  total: number
  page: number
  totalPages: number
}

const SOURCES = {
  AUTOSCOUT: "AutoScout",
  MARKTPLAATS: "Marktplaats",
} as const

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Filter state
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [source, setSource] = useState("all")
  const [sortBy, setSortBy] = useState("recent")

  const fetchListings = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: page.toString(),
      limit: "20",
      ...(make && { make }),
      ...(model && { model }),
      ...(source !== "all" && { source: source.toUpperCase() }),
      sortBy,
    })

    try {
      const res = await fetch(`/api/listings?${params}`)
      const data: ListingsResponse = await res.json()
      setListings(data.listings)
      setTotalPages(data.totalPages)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch listings:", error)
      setListings([])
    } finally {
      setLoading(false)
    }
  }, [page, make, model, source, sortBy])

  useEffect(() => {
    fetchListings()
  }, [fetchListings])

  const handleSearch = () => {
    setPage(1)
    fetchListings()
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  function formatPrice(value: number) {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  function formatMileage(value: number | null) {
    if (value === null) return "-"
    return new Intl.NumberFormat("nl-NL").format(value) + " km"
  }

  function formatSource(src: string) {
    return SOURCES[src as keyof typeof SOURCES] || src
  }

  function renderDealBadge(discountPercent: number | null, savings: number | null) {
    if (discountPercent === null) {
      return <Badge variant="secondary" className="bg-gray-200 text-gray-700">geen data</Badge>
    }

    if (discountPercent >= 15) {
      return (
        <Badge className="bg-green-600 text-white">
          -{discountPercent}% · {formatPrice(savings || 0)} goedkoper
        </Badge>
      )
    }

    if (discountPercent < -5) {
      return <Badge variant="destructive">boven markt</Badge>
    }

    return <Badge variant="outline">neutraal</Badge>
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1">Advertenties</h1>
        <p className="text-sm text-gray-600">
          {total > 0 ? `${total.toLocaleString("nl-NL")} advertenties gevonden` : "Geen advertenties gevonden"}
        </p>
      </div>

      {/* Filter Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-2">Merk</label>
              <Input
                placeholder="bijv. BMW"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Model</label>
              <Input
                placeholder="bijv. 3 Serie"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Bron</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
              >
                <option value="all">Alle bronnen</option>
                <option value="AUTOSCOUT">AutoScout</option>
                <option value="MARKTPLAATS">Marktplaats</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Sorteren op</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
              >
                <option value="recent">Meest recent</option>
                <option value="price_asc">Goedkoopste</option>
                <option value="price_desc">Duurste</option>
                <option value="discount">Beste deals eerst</option>
              </select>
            </div>

            <Button onClick={handleSearch} className="w-full">
              Zoeken
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle>Advertenties</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : listings.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <p>Geen advertenties gevonden. Pas je filters aan.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Auto</TableHead>
                      <TableHead className="font-semibold">Kilometerstand</TableHead>
                      <TableHead className="font-semibold">Vraagprijs</TableHead>
                      <TableHead className="font-semibold">Marktwaarde</TableHead>
                      <TableHead className="font-semibold">Deal</TableHead>
                      <TableHead className="font-semibold">Bron</TableHead>
                      <TableHead className="font-semibold">Stad</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.map((listing) => (
                      <TableRow
                        key={listing.id}
                        className={
                          listing.discountPercent !== null && listing.discountPercent >= 15
                            ? "bg-green-50 border-l-4 border-l-green-500"
                            : ""
                        }
                      >
                        <TableCell className="font-semibold">
                          {listing.make} {listing.model}
                          {listing.year && <span className="text-gray-500 text-sm ml-2">({listing.year})</span>}
                        </TableCell>
                        <TableCell className="text-gray-700">{formatMileage(listing.mileage)}</TableCell>
                        <TableCell className="font-semibold text-gray-900">{formatPrice(listing.price)}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {listing.marketValue ? (
                            <div>
                              {formatPrice(listing.marketValue)}
                              <div className="text-xs text-gray-500">
                                ({listing.profileSampleCount} samples)
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>{renderDealBadge(listing.discountPercent, listing.savings)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatSource(listing.source)}</Badge>
                        </TableCell>
                        <TableCell className="text-gray-700">{listing.city || "-"}</TableCell>
                        <TableCell>
                          <a
                            href={listing.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center p-1 hover:bg-gray-100 rounded transition-colors"
                          >
                            <ExternalLink className="w-4 h-4 text-gray-600 hover:text-gray-900" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
