"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  BarChart3,
  Zap,
  TrendingUp,
  Search,
  List,
  Bell,
} from "lucide-react"

const navigation = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/deals", label: "Deals", icon: Zap },
  { href: "/prices", label: "Prices", icon: TrendingUp },
  { href: "/searches", label: "Searches", icon: Search },
  { href: "/listings", label: "Listings", icon: List },
  { href: "/notifications", label: "Notifications", icon: Bell },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="hidden md:flex w-64 flex-col bg-slate-900 text-white">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold">AutoArb</h1>
        <p className="text-xs text-slate-400 mt-1">Car Price Arbitrage</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navigation.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-md transition-colors text-sm font-medium",
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800/50"
              )}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-700 text-xs text-slate-400">
        <p>AutoArb v0.1.0</p>
      </div>
    </div>
  )
}
