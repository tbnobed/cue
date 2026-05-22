import { useListTasks, useListStudios } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { motion } from "framer-motion";

export default function Tasks() {
  const [filter, setFilter] = useState<{status?: string, category?: string}>({});
  const { data: tasks, isLoading } = useListTasks(filter);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Task Registry</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Cross-Studio Operations</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {tasks?.map((task, idx) => (
            <motion.div 
              key={task.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="border-border bg-card">
                <CardContent className="p-4 flex items-center gap-4">
                  <Badge variant={task.status === 'done' ? 'default' : 'outline'} className="font-mono uppercase min-w-[100px] justify-center">
                    {task.status.replace('_', ' ')}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium">{task.title}</div>
                    <div className="text-xs text-muted-foreground font-mono flex gap-2">
                      <span>{task.studioName}</span>
                      {task.category && <span>· {task.category}</span>}
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                    {task.priority} priority
                  </Badge>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
