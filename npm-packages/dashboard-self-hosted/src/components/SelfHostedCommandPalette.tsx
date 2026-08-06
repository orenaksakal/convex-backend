import { useCallback, useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { Button } from "@ui/Button";

const PAGES = [
  {
    group: "Deployment",
    key: "health",
    label: "Health and Insights",
    href: "/",
  },
  { group: "Deployment", key: "data", label: "Data", href: "/data" },
  { group: "Deployment", key: "schema", label: "Schema", href: "/schema" },
  {
    group: "Deployment",
    key: "functions",
    label: "Functions",
    href: "/functions",
  },
  { group: "Deployment", key: "files", label: "Files", href: "/files" },
  {
    group: "Deployment",
    key: "schedules",
    label: "Scheduled functions",
    href: "/schedules/functions",
  },
  {
    group: "Deployment",
    key: "schedules",
    label: "Cron jobs",
    href: "/schedules/crons",
  },
  { group: "Deployment", key: "logs", label: "Logs", href: "/logs" },
  { group: "Deployment", key: "history", label: "History", href: "/history" },
  {
    group: "Settings",
    key: "settings",
    label: "Deployment summary and providers",
    href: "/settings",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Environment variables",
    href: "/settings/environment-variables",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Authentication",
    href: "/settings/authentication",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Snapshot import and export",
    href: "/settings/snapshots",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Backup and restore",
    href: "/settings/backups",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Runtime capacity",
    href: "/settings/runtime",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Security",
    href: "/settings/security",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Releases and recovery",
    href: "/settings/releases",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Alerts",
    href: "/settings/alerts",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Components",
    href: "/settings/components",
  },
  {
    group: "Settings",
    key: "settings",
    label: "Integrations",
    href: "/settings/integrations",
  },
] as const;

export function SelfHostedCommandPalette({
  visiblePages,
}: {
  visiblePages?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => {
          if (value) {
            setQuery("");
            setSelectedIndex(0);
          }
          return !value;
        });
      }
      if (event.key === "Escape") closePalette();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [closePalette]);

  useEffect(() => {
    const close = () => closePalette();
    router.events.on("routeChangeComplete", close);
    return () => router.events.off("routeChangeComplete", close);
  }, [closePalette, router.events]);

  const pages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return PAGES.filter(
      (page) =>
        (!visiblePages || visiblePages.includes(page.key)) &&
        (!normalized ||
          `${page.group} ${page.label}`.toLowerCase().includes(normalized)),
    );
  }, [query, visiblePages]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= pages.length) setSelectedIndex(0);
  }, [pages.length, selectedIndex]);

  function navigateToSelectedPage() {
    const selected = pages[selectedIndex];
    if (selected) void router.push(selected.href);
  }

  return (
    <>
      <Button
        className="fixed top-3 right-14 z-50 hidden sm:flex"
        size="xs"
        variant="neutral"
        onClick={() => {
          setQuery("");
          setSelectedIndex(0);
          setOpen(true);
        }}
        aria-label="Open deployment command palette"
      >
        <MagnifyingGlassIcon />
        Navigate
        <kbd className="ml-1 rounded-sm border bg-background-tertiary px-1 text-[10px] text-content-secondary">
          ⌘K
        </kbd>
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-100 flex items-start justify-center bg-background-primary/70 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closePalette();
          }}
        >
          <section
            className="w-full max-w-xl overflow-hidden rounded-lg border bg-background-secondary shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="self-hosted-palette-title"
          >
            <h2 id="self-hosted-palette-title" className="sr-only">
              Navigate this Convex deployment
            </h2>
            <label className="flex items-center gap-2 border-b px-4">
              <MagnifyingGlassIcon className="text-content-secondary" />
              <input
                className="h-12 w-full bg-transparent text-content-primary outline-hidden"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedIndex((index) =>
                      pages.length === 0 ? 0 : (index + 1) % pages.length,
                    );
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((index) =>
                      pages.length === 0
                        ? 0
                        : (index - 1 + pages.length) % pages.length,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    navigateToSelectedPage();
                  }
                }}
                placeholder="Find a deployment page"
                autoFocus
                role="combobox"
                aria-autocomplete="list"
                aria-controls="self-hosted-palette-options"
                aria-expanded="true"
                aria-activedescendant={
                  pages[selectedIndex]
                    ? `self-hosted-palette-option-${selectedIndex}`
                    : undefined
                }
              />
            </label>
            <div
              id="self-hosted-palette-options"
              className="scrollbar max-h-[55vh] overflow-y-auto p-2"
              role="listbox"
            >
              {pages.length === 0 ? (
                <div className="p-4 text-center text-sm text-content-secondary">
                  No matching deployment page.
                </div>
              ) : (
                pages.map((page, index) => (
                  <Button
                    key={`${page.href}:${page.label}`}
                    id={`self-hosted-palette-option-${index}`}
                    role="option"
                    aria-selected={selectedIndex === index}
                    variant="unstyled"
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-background-tertiary focus:bg-background-tertiary focus:outline-hidden ${
                      selectedIndex === index ? "bg-background-tertiary" : ""
                    }`}
                    onMouseOver={() => setSelectedIndex(index)}
                    onClick={() => void router.push(page.href)}
                  >
                    <span>{page.label}</span>
                    <span className="text-xs text-content-secondary">
                      {page.group}
                    </span>
                  </Button>
                ))
              )}
            </div>
            <div className="border-t px-4 py-2 text-xs text-content-secondary">
              Navigation only. Restart, restore, release, rollback, repair, and
              other destructive actions remain on their typed-confirmation
              pages.
            </div>
          </section>
        </div>
      )}
    </>
  );
}
