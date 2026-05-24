import { useListMembers } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

export default function Team() {
  const { data: members, isLoading } = useListMembers();

  return (
    <div className="w-full space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Personnel Roster
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Active crew</h1>
        </div>
        {members && (
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : members && members.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((member, idx) => {
            const initials = (member.name || "?")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join("");
            return (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="group surface-card ring-hairline border border-border/70 rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-border hover:-translate-y-0.5 hover:shadow-lg"
              >
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="w-12 h-12 rounded-full ring-1 ring-border shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/30 text-primary flex items-center justify-center text-sm font-mono font-semibold shrink-0">
                    {initials || "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold tracking-tight truncate">{member.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 font-mono">
                    <span className="capitalize">{member.role}</span>
                    {member.department && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-border" />
                        <span>{member.department}</span>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono">
          No crew members yet.
        </div>
      )}
    </div>
  );
}
