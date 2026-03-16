"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Loader2, ExternalLink } from "lucide-react"

interface Listing {
  id: string
  title: string
  make: string
  model: string
  year: number
  mileage: number
  price: number
  source: string
  city: string
  status: string
  url: string
}

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    fetch("/api/listings?limit=50").then(r => r.json() as Promise<{ listings?: Listing[] }>).then(d => {
      setListings(d.listings || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function formatPrice(v: number) {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v)
  }

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Listings</h1>
      <p className="text-muted-foreground mb-6">View and manage car listings</p>
      
      <Card className="mb-6">
        <CardContent className="pt-6">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch((e.target as HTMLInputElement).value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Listings</CardTitle>
          <CardDescription>{listings.length} listings</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : listings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Car</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Mileage</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.make} {l.model}</TableCell>
                    <TableCell>{l.year}</TableCell>
                    <TableCell>{l.mileage}km</TableCell>
                    <TableCell>{formatPrice(l.price)}</TableCell>
                    <TableCell><Badge>{l.source}</Badge></TableCell>
                    <TableCell>{l.city}</TableCell>
                    <TableCell><a href={l.url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /></a></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-8 text-center text-muted-foreground">No listings</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
