"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

interface DashboardShellProps {
  userEmail: string;
  children: React.ReactNode;
}

interface NavItemConfig {
  label: string;
  href?: string;
  isAvailable: boolean;
  unavailableNote?: string;
  badge?: string;
  icon: (props: { className?: string }) => React.JSX.Element;
}

function IconInbox({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function IconAlertTriangle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconUsers({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconFileText({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconActivity({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconSettings({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconUserBadge({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    label: "Inbox / Antrean",
    href: "/dashboard",
    isAvailable: true,
    icon: IconInbox,
  },
  {
    label: "Gangguan",
    isAvailable: false,
    badge: "Belum tersedia",
    unavailableNote: "Insiden massal & evaluasi OLT mock",
    icon: IconAlertTriangle,
  },
  {
    label: "Pelanggan",
    href: "/dashboard/customers",
    isAvailable: true,
    icon: IconUsers,
  },
  {
    label: "Template",
    isAvailable: false,
    badge: "Belum tersedia",
    unavailableNote: "Template balasan Telegram",
    icon: IconFileText,
  },
  {
    label: "Log & kesehatan",
    isAvailable: false,
    badge: "Belum tersedia",
    unavailableNote: "Decision snapshot & audit trail",
    icon: IconActivity,
  },
  {
    label: "Pengaturan",
    isAvailable: false,
    badge: "Belum tersedia",
    unavailableNote: "Mode automation & allowlist",
    icon: IconSettings,
  },
];

export function DashboardShell({ userEmail, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseBtnRef = useRef<HTMLButtonElement>(null);

  // Floating tooltip state for compact sidebar (renders outside scroll container to eliminate overflow-y clipping)
  const [compactTooltip, setCompactTooltip] = useState<{
    label: string;
    badge?: string;
    top: number;
  } | null>(null);

  // Reset drawer state when pathname changes without cascading effect renders
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setIsDrawerOpen(false);
  }

  // Drawer modal accessibility: Focus trap, Escape key, and body scroll lock
  useEffect(() => {
    if (!isDrawerOpen) return;

    // Capture trigger reference for clean restoration
    const triggerEl = drawerTriggerRef.current;

    // Body scroll lock
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus close button initially
    drawerCloseBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsDrawerOpen(false);
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    const handleResize = () => {
      // Clean up drawer if screen resizes to desktop breakpoint (>=1024px)
      if (window.innerWidth >= 1024) {
        setIsDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      triggerEl?.focus();
    };
  }, [isDrawerOpen]);

  // Determine active route title for Topbar
  let pageTitle = "Inbox / Antrean";
  if (pathname.startsWith("/dashboard/customers")) {
    pageTitle = "Pelanggan";
  }

  const isItemActive = (item: NavItemConfig) => {
    if (!item.isAvailable || !item.href) return false;
    if (item.href === "/dashboard") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/complaints");
    }
    return pathname.startsWith(item.href);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex">
      {/* Skip Link for Keyboard Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-[var(--bg-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--text-primary)] focus:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2"
      >
        Lewati ke konten utama
      </a>

      {/* ====================================================================
          DESKTOP SIDEBAR CONTAINER
          Breakpoint:
          - <1024px: Hidden (display: none via .dashboard-sidebar-container)
          - 1024px - 1439px: Compact Sidebar (width 72px)
          - >= 1440px: Full Sidebar (width 216px)
          Palet: Navy var(--color-primary), border var(--border-panel-navy)
          ==================================================================== */}
      <aside
        aria-label="Sidebar utama"
        className="dashboard-sidebar-container relative bg-[var(--color-primary)] border-r border-[var(--border-panel-navy)] min-h-screen text-[var(--color-panel-on-navy)]"
      >
        {/* Brand Header */}
        <div className="h-16 px-3 flex items-center justify-center border-b border-[var(--border-panel-navy)]">
          {/* Logo Mark (Visible in both 72px and 216px) */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[var(--radius-control)] bg-[var(--border-panel-navy)] border border-[var(--border-panel-navy)] flex items-center justify-center shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--brand-accent)]" aria-hidden="true" />
            </div>
            {/* Expanded brand text only at >=1440px */}
            <div className="sidebar-expanded-only min-w-0 flex-col">
              <span className="text-sm font-bold tracking-tight text-[var(--color-panel-on-navy)] block truncate leading-tight">
                Upaznet Helpdesk
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-[var(--color-panel-text)] block uppercase">
                Workspace
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav
          aria-label="Navigasi utama"
          onScroll={() => setCompactTooltip(null)}
          className="flex-1 py-4 px-2 space-y-1.5 overflow-y-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = isItemActive(item);
            const Icon = item.icon;

            if (item.isAvailable && item.href) {
              return (
                <div key={item.label} className="w-full">
                  {/* EXPANDED VIEW (>=1440px): Icon + Label */}
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`sidebar-expanded-only group items-center gap-3 px-3 py-2 text-sm rounded-[var(--radius-control)] transition-colors min-h-[var(--control-height-default)] border-l-4 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color-navy)] focus-visible:outline-offset-2 ${
                      active
                        ? "bg-[var(--border-panel-navy)] text-[var(--color-panel-on-navy)] font-semibold border-[var(--brand-accent)]"
                        : "text-[var(--color-panel-text)] hover:text-[var(--color-panel-on-navy)] hover:bg-[var(--bg-panel-item-hover)] border-transparent font-medium"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 shrink-0 ${
                        active ? "text-[var(--brand-accent)]" : "text-[var(--color-panel-text)] group-hover:text-[var(--text-on-navy)]"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>

                  {/* COMPACT VIEW (1024-1439px): Centered Icon + Accessible Name + Hover/Focus Floating Tooltip */}
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setCompactTooltip({
                        label: item.label,
                        top: rect.top + rect.height / 2,
                      });
                    }}
                    onMouseLeave={() => setCompactTooltip(null)}
                    onFocus={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setCompactTooltip({
                        label: item.label,
                        top: rect.top + rect.height / 2,
                      });
                    }}
                    onBlur={() => setCompactTooltip(null)}
                    className={`sidebar-compact-only group relative items-center justify-center rounded-[var(--radius-control)] min-h-[var(--control-height-default)] w-full transition-colors border-l-4 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color-navy)] focus-visible:outline-offset-2 ${
                      active
                        ? "bg-[var(--border-panel-navy)] text-[var(--color-panel-on-navy)] border-[var(--brand-accent)]"
                        : "text-[var(--color-panel-text)] hover:text-[var(--color-panel-on-navy)] hover:bg-[var(--bg-panel-item-hover)] border-transparent"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 shrink-0 ${
                        active ? "text-[var(--brand-accent)]" : "text-[var(--color-panel-text)] group-hover:text-[var(--text-on-navy)]"
                      }`}
                    />
                  </Link>
                </div>
              );
            }

            // Non-interactive disabled items (No 404 links, no broken buttons)
            return (
              <div key={item.label} className="w-full">
                {/* EXPANDED VIEW (>=1440px): Icon + Label + Badge */}
                <div
                  role="presentation"
                  className="sidebar-expanded-only flex-col px-3 py-2 text-sm rounded-[var(--radius-control)] text-[var(--color-panel-text)]/50 cursor-not-allowed border-l-4 border-transparent select-none min-h-[var(--control-height-default)]"
                  title={item.unavailableNote}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="w-5 h-5 shrink-0 text-[var(--color-panel-text)]/40" />
                      <span className="truncate text-xs font-normal">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-panel-badge)] text-[var(--color-panel-text)]">
                        {item.badge}
                      </span>
                    )}
                  </div>
                </div>

                {/* COMPACT VIEW (1024-1439px): Centered Icon + Disabled Tooltip */}
                <div
                  role="presentation"
                  aria-label={`${item.label} (${item.badge || "Belum tersedia"})`}
                  title={`${item.label} (${item.badge || "Belum tersedia"})`}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCompactTooltip({
                      label: item.label,
                      badge: item.badge || "Belum tersedia",
                      top: rect.top + rect.height / 2,
                    });
                  }}
                  onMouseLeave={() => setCompactTooltip(null)}
                  className="sidebar-compact-only group relative items-center justify-center rounded-[var(--radius-control)] min-h-[var(--control-height-default)] w-full text-[var(--color-panel-text)]/40 cursor-not-allowed border-l-4 border-transparent select-none"
                >
                  <Icon className="w-5 h-5 shrink-0 text-[var(--color-panel-text)]/40" />
                </div>
              </div>
            );
          })}
        </nav>

        {/* Floating Tooltip for Compact Sidebar (Rendered outside <nav> scroll container to eliminate overflow-y clipping) */}
        {compactTooltip && (
          <div
            role="tooltip"
            aria-hidden="true"
            className="sidebar-compact-only fixed z-50 pointer-events-none items-center"
            style={{
              left: "80px",
              top: `${compactTooltip.top}px`,
              transform: "translateY(-50%)",
            }}
          >
            <div className="px-2.5 py-1 rounded-[var(--radius-control)] bg-[var(--brand-primary)] border border-[var(--border-panel-navy)] text-[var(--color-panel-on-navy)] text-xs font-medium whitespace-nowrap shadow-xl flex items-center gap-1.5">
              <span>{compactTooltip.label}</span>
              {compactTooltip.badge && (
                <span className="text-[var(--status-warning-text)] bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] font-semibold text-[10px] px-1 py-0.5 rounded">
                  {compactTooltip.badge}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Sidebar Footer Note (Expanded only) */}
        <div className="sidebar-expanded-only p-3 border-t border-[var(--border-panel-navy)] text-xs text-[var(--color-panel-text)]/80 leading-relaxed">
          <p className="font-semibold text-[var(--text-on-navy)] text-[11px] mb-1">Prototype Helpdesk</p>
          <p className="text-[11px] text-[var(--color-panel-text)]/70">
            Seluruh data operasional adalah simulasi pengujian.
          </p>
        </div>
      </aside>

      {/* ====================================================================
          MOBILE DRAWER MODAL (< 1024px)
          ==================================================================== */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-[var(--bg-overlay-backdrop)] transition-opacity"
            onClick={() => setIsDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Dialog Container */}
          <div
            id="dashboard-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            className="fixed inset-y-0 left-0 z-50 w-[260px] max-w-[85vw] bg-[var(--color-primary)] text-[var(--color-panel-on-navy)] shadow-2xl flex flex-col focus:outline-none"
          >
            {/* Drawer Header */}
            <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--border-panel-navy)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-[var(--radius-control)] bg-[var(--border-panel-navy)] border border-[var(--border-panel-navy)] flex items-center justify-center shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[var(--brand-accent)]" aria-hidden="true" />
                </div>
                <span className="text-sm font-bold text-[var(--text-on-navy)] truncate">Upaznet Helpdesk</span>
              </div>
              <button
                ref={drawerCloseBtnRef}
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Tutup menu navigasi"
                className="inline-flex min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] items-center justify-center rounded-[var(--radius-control)] text-[var(--text-on-navy)]/80 hover:text-[var(--text-on-navy)] hover:bg-[var(--bg-panel-item-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color-navy)] focus-visible:outline-offset-2"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Drawer Nav Items */}
            <nav aria-label="Navigasi mobile" className="flex-1 py-4 px-2 space-y-1.5 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const active = isItemActive(item);
                const Icon = item.icon;

                if (item.isAvailable && item.href) {
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setIsDrawerOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-3 px-3 py-2.5 text-sm rounded-[var(--radius-control)] transition-colors min-h-[var(--control-height-touch)] border-l-4 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color-navy)] focus-visible:outline-offset-2 ${
                        active
                          ? "bg-[var(--border-panel-navy)] text-[var(--color-panel-on-navy)] font-semibold border-[var(--brand-accent)]"
                          : "text-[var(--color-panel-text)] hover:text-[var(--color-panel-on-navy)] hover:bg-[var(--bg-panel-item-hover)] border-transparent font-medium"
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 shrink-0 ${
                          active ? "text-[var(--brand-accent)]" : "text-[var(--color-panel-text)] group-hover:text-[var(--text-on-navy)]"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                }

                return (
                  <div
                    key={item.label}
                    role="presentation"
                    className="flex flex-col px-3 py-2 text-sm rounded-[var(--radius-control)] text-[var(--color-panel-text)]/50 cursor-not-allowed border-l-4 border-transparent select-none min-h-[var(--control-height-touch)]"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon className="w-5 h-5 shrink-0 text-[var(--color-panel-text)]/40" />
                        <span className="truncate text-xs">{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-panel-badge)] text-[var(--color-panel-text)]">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-[var(--border-panel-navy)] text-xs text-[var(--color-panel-text)]/80">
              <p className="font-semibold text-[var(--text-on-navy)] mb-1">Prototype · Data dummy</p>
              <p className="text-[11px] text-[var(--color-panel-text)]/70 leading-relaxed">
                Antrean komplain masuk Telegram dan auto-triage akan tersedia pada tahap berikutnya.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          AREA KONTEN FLEKSIBEL (Topbar 64px + Main Content)
          ==================================================================== */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Topbar (Tinggi 64px) */}
        <header className="h-16 shrink-0 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-30">
          {/* Left: Mobile Drawer Trigger + Page Title + Prototype Badge */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <button
              ref={drawerTriggerRef}
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Buka menu navigasi"
              aria-expanded={isDrawerOpen}
              aria-controls="dashboard-drawer"
              className="lg:hidden inline-flex min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <span className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight truncate">
              {pageTitle}
            </span>

            <span className="hidden sm:inline-flex items-center rounded-full bg-[var(--status-info-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--status-info-text)] border border-[var(--status-info-border)] shrink-0">
              Prototype · Data dummy
            </span>
          </div>

          {/* Right: Staff User Profile & Logout */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <span className="inline-flex sm:hidden items-center rounded-full bg-[var(--status-info-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-info-text)] border border-[var(--status-info-border)]">
              Data dummy
            </span>

            <div
              className="flex items-center gap-2 text-[var(--text-secondary)] text-xs sm:text-sm font-medium"
              title={`Masuk sebagai: ${userEmail}`}
            >
              <span className="w-8 h-8 rounded-full bg-[var(--bg-rail)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
                <IconUserBadge className="w-4 h-4" />
              </span>
              <span className="hidden md:inline-block max-w-[180px] lg:max-w-[220px] truncate">
                {userEmail}
              </span>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
              >
                Keluar
              </button>
            </form>
          </div>
        </header>

        {/* Main Content Area (Fleksibel, tanpa max-width sempit) */}
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 outline-none ${
            pathname === "/dashboard" || pathname.startsWith("/dashboard/complaints")
              ? "p-0 flex flex-col"
              : "p-4 sm:p-6 lg:p-8"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
