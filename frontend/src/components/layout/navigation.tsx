import { BarChart3Icon, FilesIcon, HomeIcon, SettingsIcon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"

const items = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/files", label: "Files", icon: FilesIcon },
  { to: "/statistics", label: "Stats", icon: BarChart3Icon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
]

export function DesktopNavigation() {
  return (
    <nav className="space-y-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn(
            "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
            isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function MobileNavigation() {
  return (
    <nav className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden">
      <div className="safe-bottom mx-auto grid max-w-lg grid-cols-4 px-2 pt-1.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {({ isActive }) => (
              <>
                <span className={cn("flex h-7 min-w-12 items-center justify-center rounded-full transition-colors", isActive && "bg-primary/60")}> 
                  <Icon className="size-4.5" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
