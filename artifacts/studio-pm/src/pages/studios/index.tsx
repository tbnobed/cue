import { useListStudios } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

export default function StudiosList() {
  const { data: studios, isLoading } = useListStudios();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Studios</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Active Deployments</p>
        </div>
        {/* TODO: Add Studio button */}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {studios?.map((studio, idx) => (
            <motion.div 
              key={studio.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/studios/${studio.id}`} className="block h-full hover-elevate">
                <Card className="h-full border-border bg-card hover:border-primary transition-colors cursor-pointer group flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline" className="font-mono uppercase text-[10px]">
                        {studio.status.replace('_', ' ')}
                      </Badge>
                      {studio.phase && <span className="text-xs text-muted-foreground font-mono">{studio.phase}</span>}
                    </div>
                    <CardTitle className="text-xl group-hover:text-primary transition-colors">{studio.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-sm">{studio.description || "No description provided."}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4">
                    <div className="flex justify-between text-xs text-muted-foreground font-mono border-t border-border pt-4">
                      <span>{studio.location || "TBD"}</span>
                      {studio.targetDate && <span>Target: {new Date(studio.targetDate).toLocaleDateString()}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
