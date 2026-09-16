import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export function NotFoundPage() {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center"><p className="text-5xl font-semibold">404</p><p className="text-muted-foreground mt-3 text-sm">This page does not exist.</p><Button asChild className="mt-5"><Link to="/">Go home</Link></Button></div>
}
