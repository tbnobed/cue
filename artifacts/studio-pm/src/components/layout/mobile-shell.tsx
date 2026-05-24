import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Video, CheckSquare, Users, FolderOpen,
  Bell, ChevronLeft,
} from "lucide-react";
import cueMark from "@/assets/cue-icon_1779576125630.svg";

type TitleState = {
  title: string;
  subtitle?: string;
  backHref?: string;
};

const MobileTitleContext = createContext<{
  set: (t: TitleState | null) => void;
} | null>(null);

/**
 * Mobile pages call this to override the app bar title for their route.
 * Pass `null` (or unmount) to fall back to the default.
 */
export function useMobileTitle(t: TitleState | null) {
  const ctx = useContext(MobileTitleContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.set(t);
    // Intentionally do NOT reset on every dep change — only on unmount.
    // Resetting on each change caused a one-frame fallback-title flicker
    // when callers passed a new object literal as their title updated
    // (e.g. "Loading…" → real project name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.title, t?.subtitle, t?.backHref, ctx]);
  useEffect(() => {
    return () => { ctx?.set(null); };
  }, [ctx]);
}

const TABS: Array<{ href: string; label: string; icon: typeof LayoutDashboard; match: (p: string) => boolean }> = [
  { href: "/",          label: "Home",     icon: LayoutDashboard, match: (p) => p === "/" },
  { href: "/projects",  label: "Projects", icon: Video,           match: (p) => p.startsWith("/projects") },
  { href: "/tasks",     label: "Tasks",    icon: CheckSquare,     match: (p) => p.startsWith("/tasks") },
  { href: "/team",      label: "Team",     icon: Users,           match: (p) => p.startsWith("/team") },
  { href: "/documents", label: "Docs",     icon: FolderOpen,      match: (p) => p.startsWith("/documents") },
];

export function MobileShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [override, setOverride] = useState<TitleState | null>(null);
  const ctxValue = useMemo(() => ({ set: setOverride }), []);

  const fallback: TitleState = useMemo(() => {
    if (location === "/")                  return { title: "Cue",       subtitle: "Production Suite" };
    if (location.startsWith("/projects"))  return { title: "Projects",  subtitle: "Active deployments" };
    if (location.startsWith("/tasks"))     return { title: "Tasks",     subtitle: "Cross-project ops" };
    if (location.startsWith("/team"))      return { title: "Team",      subtitle: "Personnel roster" };
    if (location.startsWith("/documents")) return { title: "Documents", subtitle: "All files" };
    if (location.startsWith("/admin"))     return { title: "Admin",     subtitle: "Operators" };
    return { title: "Cue", subtitle: "Production Suite" };
  }, [location]);

  const title = override ?? fallback;

  return (
    <MobileTitleContext.Provider value={ctxValue}>
      <div className="mshell dark flex flex-col min-h-[100dvh] w-full bg-background text-foreground">
        <div className="appbar">
          {title.backHref ? (
            <Link href={title.backHref} className="ab-btn" aria-label="Back" data-testid="mobile-back">
              <ChevronLeft />
            </Link>
          ) : (
            <div className="mk">
              <img src={cueMark} alt="Cue" className="w-7 h-7" />
            </div>
          )}
          <div className="ttl">
            <b>{title.title}</b>
            {title.subtitle && <span>{title.subtitle}</span>}
          </div>
          <button type="button" className="ab-btn" aria-label="Notifications">
            <Bell />
          </button>
        </div>

        <div className="mbody">{children}</div>

        <nav className="tabbar" aria-label="Primary">
          {TABS.map((tab) => {
            const active = tab.match(location);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`tab ${active ? "on" : ""}`}
                aria-current={active ? "page" : undefined}
                data-testid={`mobile-tab-${tab.label.toLowerCase()}`}
              >
                <Icon strokeWidth={2} />
                <span>{tab.label}</span>
                <i className="ind" />
              </Link>
            );
          })}
        </nav>
      </div>
    </MobileTitleContext.Provider>
  );
}

/** Shared FAB used by mobile pages. Renders fixed-positioned. */
export function MobileFab({
  onClick, label, children,
}: { onClick?: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fab"
      aria-label={label}
      data-testid="mobile-fab"
    >
      {children}
    </button>
  );
}
