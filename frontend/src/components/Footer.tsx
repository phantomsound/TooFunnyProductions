import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../lib/SettingsContext";

const Footer: React.FC = () => {
  const { settings } = useSettings();

  const footerText =
    (settings && typeof settings === "object" && (settings as any).footer_text) ||
    "© 2025 Too Funny Productions. All rights reserved.";

  const footerLinks = Array.isArray((settings as any)?.footer_links)
    ? ((settings as any).footer_links as Array<{ label?: string; url?: string }>).filter(
        (entry) => typeof entry?.label === "string" && typeof entry?.url === "string"
      )
    : [];

  return (
    <footer className="bg-brandDark text-white py-8 text-center space-y-3">
      <p className="text-sm">{footerText}</p>

      {footerLinks.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-4 text-xs text-white/70">
          {footerLinks.map((link, idx) => (
            <li key={`${link.url}-${idx}`}>
              <a
                href={link.url as string}
                className="hover:text-white"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="text-[11px] text-white/30">
        <Link to="/admin" className="uppercase tracking-[0.25em] hover:text-white/60">
          admin login
        </Link>
      </div>
    </footer>
  );
};

export default Footer;
