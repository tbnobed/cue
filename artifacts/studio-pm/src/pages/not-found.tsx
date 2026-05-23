import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="dark min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <div className="surface-card ring-hairline border border-border rounded-2xl shadow-xl w-full max-w-md p-7 text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-red-500/10 ring-1 ring-red-500/20 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
          Error 404
        </div>
        <h1 className="text-xl font-semibold tracking-tight mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-5">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Return to Command Center
        </Link>
      </div>
    </div>
  );
}
