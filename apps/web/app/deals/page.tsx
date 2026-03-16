"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Pagination } from "@/components/shared/pagination"
import { Loader2 } from "lucide-react"

interface Deal {
  id: string
  make: string
  model: string
  dealScorePercent: number
  savingsEur: number
  source: string
  createdAt: string
  acknowledged: boolean
}

const SOURCES = ["All", "MarketplaceA", "MarketplaceB", "MarketplaceC"]

function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value)
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

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [makeFilter, setMakeFilter] = useState("")
  const [modelFilter, setModelFilter] = useState("")
  const [sourceFilter, setSourceFilter] = useState("All")
  const [showUnacknowledged, setShowUnacknowledged] = useState(false)

  useEffect(() => {
    fetchDeals()
  }, [currentPage, makeFilter, modelFilter, sourceFilter, showUnacknowledged])

  async function fetchDeals() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "20",
        ...(makeFilter && { make: makeFilter }),
        ...(modelFilter && { model: modelFilter }),
        ...(sourceFilter !== "All" && { source: sourceFilter }),
        ...(showUnacknowledged && { acknowledged: "false" }),
      })
      const res = await fetch(`/api/deals?${params}`)
      if (!res.ok) throw new Error("Failed to fetch deals")
      const data = (await res.json()) as { deals?: Deal[]; totalPages?: number }
      setDeals(data.deals || [])
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
    setShowUnacknowledged(false)
    setCurrentPage(1)
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Deals</h1>
        <p className="text-muted-foreground mt-2">Filter and review detected car deals</p>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-lg">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div><label className="block text-sm font-medium mb-2">Make</label><Input placeholder="e.g., BMW" value={makeFilter} onChange={(e) => { setMakeFilter((e.target as HTMLInputElement).value); setCurrentPage(1) }} /></div>
            <div><label className="block text-sm font-medium mb-2">Model</label><Input placeholder="e.g., 3 Series" value={modelFilter} onChange={(e) => { setModelFilter((e.target as HTMLInputElement).value); setCurrentPage(1) }} /></div>
            <div><label className="block text-sm font-medium mb-2">Source</label><Select value={sourceFilter} onChange={(e) => { setSourceFilter((e.target as HTMLSelectElement).value); setCurrentPage(1) }}>{SOURCES.map((source) => (<option key={source} value={source}>{source}</option>))}</Select></div>
            <div className="flex items-end gap-2"><label className="flex items-center gap-2 cursor-pointer flex-1"><Switch checked={showUnacknowledged} onChange={(e) => { setShowUnacknowledged((e.target as HTMLInputElement).checked); setCurrentPage(1) }} /><span className="text-sm font-medium">Unacknowledged only</span></label></div>
          </div>
          <Button variant="outline" size="sm" onClick={handleResetFilters}>Reset Filters</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Deals</CardTitle><CardDescription>{loading ? "Loading..." : `${deals.length} deals found`}</CardDescription></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : deals.length > 0 ? (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Car</TableHead><TableHead>Deal Score</TableHead><TableHead>Savings</TableHead><TableHead>Source</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {deals.map((deal) => (
                    <TableRow key={deal.id} className={deal.acknowledged ? "" : "bg-yellow-50/30"}>
                      <TableCell className="font-medium">{deal.make} {deal.model}</TableCell>
                      <TableCell><Badge variant={deal.dealScorePercent > 20 ? "default" : "secondary"}>{deal.dealScorePercent}%</Badge></TableCell>
                      <TableCell className="text-green-600 font-medium">{formatPrice(deal.savingsEur)}</TableCell>
                      <TableCell>{deal.source}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(deal.createdAt)}</TableCell>
                      <TableCell><Badge variant={deal.acknowledged ? "outline" : "default"}>{deal.acknowledged ? "Seen" : "New"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">No deals found matching your filters.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
