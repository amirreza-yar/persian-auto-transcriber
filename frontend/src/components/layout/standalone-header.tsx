import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function StandaloneHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-5">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeftIcon />
        </Button>
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={title}
        >
          {title}
        </p>
        {actions}
      </div>
    </header>
  );
}
