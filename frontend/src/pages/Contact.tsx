import React, { useState } from "react";
import PageContainer from "../components/PageContainer";
import { useSettings } from "../lib/SettingsContext";
import { api } from "../lib/api";

export default function Contact() {
  const { settings } = useSettings();
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const title = typeof settings?.contact_title === "string" ? settings.contact_title : "Contact Us";
  const intro =
    typeof settings?.contact_intro === "string"
      ? settings.contact_intro
      : "Booking, collaborations, or just want to say hi? Drop us a line.";
  const cards = Array.isArray(settings?.contact_cards) ? settings.contact_cards : [];
  const socials = settings?.contact_socials && typeof settings.contact_socials === "object"
    ? (settings.contact_socials as Record<string, string>)
    : {};

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(api("/api/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          from: form.email,
          message: form.message,
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setForm({ name: "", email: "", message: "" });
      setResult("Message sent! We'll be in touch soon.");
    } catch (e: any) {
      console.error(e);
      setResult("We couldn’t send your message. Please try again later.");
    } finally {
      setSending(false);
    }
  };

  return (
    <PageContainer className="text-theme-base">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap break-words text-theme-muted">{intro}</p>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Left: form */}
        <form onSubmit={onSubmit} className="rounded border border-theme-surface bg-theme-surface p-5 sm:p-6">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-theme-base">Your Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border border-theme-surface bg-white p-2 text-black"
              placeholder="Jane Comedian"
              required
            />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-theme-base">Your Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded border border-theme-surface bg-white p-2 text-black"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-sm font-semibold text-theme-base">Message</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="h-32 w-full rounded border border-theme-surface bg-white p-2 text-black"
              placeholder="Say hello..."
              required
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className={`rounded px-4 py-2 font-semibold ${
              sending ? "bg-gray-400 text-gray-700" : "theme-accent-button"
            }`}
          >
            {sending ? "Sending…" : "Send Message"}
          </button>
          {result ? <p className="mt-3 text-sm text-theme-muted">{result}</p> : null}
        </form>

        {/* Right: contact details + socials */}
        <div className="rounded border border-theme-surface bg-theme-surface p-5 sm:p-6">
          <h2 className="mb-3 text-xl font-semibold text-theme-accent">Reach Us</h2>
          <div className="mb-6 space-y-1 text-theme-muted">
            {settings?.contactemail && (
              <div>
                Email: <a className="text-theme-accent hover:text-theme-accent" href={`mailto:${settings.contactemail}`}>{settings.contactemail}</a>
              </div>
            )}
            {settings?.contactphone && <div>Phone: {settings.contactphone}</div>}
          </div>

          {cards.length > 0 ? (
            <div className="mb-6 space-y-4">
              {cards.map((card: any, index: number) => (
                <div key={index} className="rounded border border-theme-surface bg-theme-background p-4">
                  <div className="mb-1 text-lg font-semibold text-theme-accent">{card.title}</div>
                  <p className="mb-3 whitespace-pre-wrap break-words text-sm text-theme-muted">{card.description}</p>
                  {card.link_url ? (
                    <a
                      href={card.link_url}
                      target={card.link_url.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="theme-accent-button inline-block rounded px-3 py-1 text-sm font-semibold transition"
                    >
                      {card.link_label || "Learn more"}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <h3 className="mb-2 text-lg font-semibold text-theme-accent">Socials</h3>
          <div className="flex flex-wrap gap-3 text-theme-muted">
            {Object.entries(socials)
              .filter(([, url]) => typeof url === "string" && url)
              .map(([network, url]) => (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="text-theme-accent hover:text-theme-accent">
                  {network.charAt(0).toUpperCase() + network.slice(1)}
                </a>
              ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
