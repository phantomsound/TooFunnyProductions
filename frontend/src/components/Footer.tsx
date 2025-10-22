import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useSettings } from "../lib/SettingsContext";

function normalizeHref(url: string): string {
  if (!url) return "#";

  const trimmed = url.trim();
  if (trimmed.startsWith("/")) return trimmed; // internal path

  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed)) {
    // already has protocol or protocol-relative (mailto:, tel:, http(s)://, etc.)
    return trimmed;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // custom scheme like mailto:, tel:
    return trimmed;
  }

  return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
}

const sitemapLinks: Array<{ label: string; to: string; preserveStage?: boolean }> = [
  { label: "Home", to: "/", preserveStage: true },
  { label: "About", to: "/about", preserveStage: true },
  { label: "Events", to: "/events", preserveStage: true },
  { label: "Media", to: "/media", preserveStage: true },
  { label: "Merch", to: "/merch", preserveStage: true },
  { label: "Contact", to: "/contact", preserveStage: true },
  { label: "Admin Login", to: "/admin", preserveStage: false },
];

const Footer: React.FC = () => {
  const { settings } = useSettings();
  const { search } = useLocation();
  const stageSuffix = new URLSearchParams(search).get("stage") === "draft" ? "?stage=draft" : "";

  const footerText =
    (settings && typeof settings === "object" && (settings as any).footer_text) ||
    "© 2025 Too Funny Productions. All rights reserved.";

  const footerLinks = Array.isArray((settings as any)?.footer_links)
    ? ((settings as any).footer_links as Array<{ label?: string; url?: string }>).filter(
        (entry) => typeof entry?.label === "string" && typeof entry?.url === "string"
      )
    : [];

  return (
    <footer className="bg-brandDark text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-yellow-200/80">
              Sitemap
            </p>
            <ul className="grid gap-3 text-sm text-white/75 sm:grid-cols-2">
              {sitemapLinks.map((item) => {
                const isExternal = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(item.to);
                if (isExternal) {
                  return (
                    <li key={item.label}>
                      <a
                        href={item.to}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition hover:text-white"
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                }

                const to = item.preserveStage ? `${item.to}${stageSuffix}` : item.to;
                return (
                  <li key={item.label}>
                    <Link to={to} className="transition hover:text-white">
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {footerLinks.length > 0 ? (
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-yellow-200/80">
                Connect
              </p>
              <ul className="flex flex-wrap gap-3 text-sm text-white/70">
                {footerLinks.map((link, idx) => {
                  const href = normalizeHref(link.url as string);
                  return (
                    <li key={`${link.url}-${idx}`}>
                      <a
                        href={href}
                        className="transition hover:text-white"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <p className="text-center text-xs text-white/50">{footerText}</p>
      </div>
    </footer>
  );
};

export default Footer;
