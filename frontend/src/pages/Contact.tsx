import React, { useState } from "react";
import { useSettings } from "../lib/SettingsContext";

const api = (path: string) => `${import.meta.env.VITE_API_BASE || "http://localhost:5000"}${path}`;

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
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-3">{title}</h1>
      <p className="opacity-80 mb-8 whitespace-pre-wrap">{intro}</p>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left: form with floating labels (always-visible labels) */}
        <form onSubmit={onSubmit} className="bg-[#111] rounded p-5">
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Your Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded p-2 bg-black text-white"
              placeholder="Jane Comedian"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Your Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border rounded p-2 bg-black text-white"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2">Message</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="w-full border rounded p-2 bg-black text-white h-32"
              placeholder="Say hello..."
              required
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className={`px-4 py-2 rounded font-semibold ${
              sending ? "bg-gray-400" : "bg-yellow-400 text-black hover:bg-yellow-300"
            }`}
          >
            {sending ? "Sending…" : "Send Message"}
          </button>
          {result ? <p className="mt-3 text-sm opacity-80">{result}</p> : null}
        </form>

        {/* Right: contact details + socials */}
        <div className="bg-[#111] rounded p-5">
          <h2 className="text-xl font-semibold mb-3">Reach Us</h2>
          <div className="space-y-1 opacity-90 mb-6">
            {settings?.contactemail && <div>Email: <a className="underline" href={`mailto:${settings.contactemail}`}>{settings.contactemail}</a></div>}
            {settings?.contactphone && <div>Phone: {settings.contactphone}</div>}
          </div>

          {cards.length > 0 ? (
            <div className="space-y-4 mb-6">
              {cards.map((card: any, index: number) => (
                <div key={index} className="rounded border border-white/10 bg-white/5 p-4">
                  <div className="text-lg font-semibold text-yellow-300 mb-1">{card.title}</div>
                  <p className="text-sm opacity-90 mb-3 whitespace-pre-wrap">{card.description}</p>
                  {card.link_url ? (
                    <a
                      href={card.link_url}
                      target={card.link_url.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="inline-block rounded bg-yellow-400 px-3 py-1 text-sm font-semibold text-black hover:bg-yellow-300"
                    >
                      {card.link_label || "Learn more"}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <h3 className="text-lg font-semibold mb-2">Socials</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(socials)
              .filter(([, url]) => typeof url === "string" && url)
              .map(([network, url]) => (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" className="underline">
                  {network.charAt(0).toUpperCase() + network.slice(1)}
                </a>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
