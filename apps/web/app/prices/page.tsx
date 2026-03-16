"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Pagination } from "@/components/shared/pagination"
import { Loader2 } from "lucide-react"

interface PriceData {
  id: string
  make: string
  model: string
  yearMin: number
  yearMax: number
  mileageBucket: string
  samples: number
  avg: number
  median: number
  p10: number
  p90: number
}

export default function PricesPage() {
  const [prices, setPrices] = useState<PriceData[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    fetchPrices()
  }, [currentPage, searchTerm])

  async function fetchPrices() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: currentPage.toString(), limit: "20", ...(searchTerm && { q: searchTerm }) })
      const res = await fetch(`/api/prices?${params}`)
      if (!res.ok) throw new Error("Failed to fetch prices")
      const data = (await res.json()) as { prices?: PriceData[]; totalPages?: number }
      setPrices(data.prices || [])
      setTotalPages(data.totalPages || 1)
    } catch (error) {
      console.error(error)
      setPrices([])
    } finally {
      setLoading(false)
    }
  }

  function formatPrice(value: number) {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value)
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Price Analysis</h1>
        <p className="text-muted-foreground mt-2">Historical price data by make and model</p>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-lg">Search</CardTitle></CardHeader>
        <CardContent>
          <Input placeholder="Search by make or model..." value={searchTerm} onChange={(e) => { setSearchTerm((e.target as HTMLInputElement).value); setCurrentPage(1) }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Prices</CardTitle><CardDescription>{loading ? "Loading..." : `${prices.length} models found`}</CardDescription></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : prices.length > 0 ? (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Make</TableHead><TableHead>Model</TableHead><TableHead>Years</TableHead><TableHead>Mileage</TableHead><TableHead>Samples</TableHead><TableHead>Avg</TableHead><TableHead>Median</TableHead><TableHead>P10-P90</TableHead></TableRow></TableHeader>
                <TableBody>
                  {prices.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.make}</TableCell>
                      <TableCell>{item.model}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.yearMin}-{item.yearMax}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.mileageBucket}</TableCell>
                      <TableCell>{item.samples}</TableCell>
                      <TableCell className="font-medium">{formatPrice(item.avg)}</TableCell>
                      <TableCell>{formatPrice(item.median)}</TableCell>
                      <TableCell><div className="w-24 bg-gray-200 rounded h-6">{formatPrice(item.p10)}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">No price data found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
