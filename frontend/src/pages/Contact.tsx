import React, { useState } from "react";
import { useSettings } from "../lib/SettingsContext";

const api = (path: string) => `${import.meta.env.VITE_API_BASE || "http://localhost:5000"}${path}`;

export default function Contact() {
  const { settings } = useSettings();
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sending, setSending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch(api("/api/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to send");
      alert("✅ Message sent!");
      setForm({ name: "", email: "", message: "" });
    } catch (e: any) {
      console.error(e);
      alert("❌ Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 text-white">
      <h1 className="text-3xl font-bold text-yellow-400 mb-6">{settings?.contact_title || "Contact Us"}</h1>
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
            className={`px-4 py-2 rounded font-semibold ${sending ? "bg-gray-400" : "bg-yellow-400 text-black hover:bg-yellow-300"}`}
          >
            {sending ? "Sending…" : "Send Message"}
          </button>
        </form>

        {/* Right: contact details + socials */}
        <div className="bg-[#111] rounded p-5">
          <h2 className="text-xl font-semibold mb-3">Reach Us</h2>
          <div className="space-y-1 opacity-90 mb-6">
            {settings?.contactemail && <div>Email: <a className="underline" href={`mailto:${settings.contactemail}`}>{settings.contactemail}</a></div>}
            {settings?.contactphone && <div>Phone: {settings.contactphone}</div>}
          </div>

          <h3 className="text-lg font-semibold mb-2">Socials</h3>
          <div className="flex flex-wrap gap-3">
            {settings?.contact_socials?.instagram && (
              <a href={settings.contact_socials.instagram} target="_blank" className="underline">Instagram</a>
            )}
            {settings?.contact_socials?.twitter && (
              <a href={settings.contact_socials.twitter} target="_blank" className="underline">Twitter/X</a>
            )}
            {settings?.contact_socials?.youtube && (
              <a href={settings.contact_socials.youtube} target="_blank" className="underline">YouTube</a>
            )}
            {settings?.contact_socials?.tiktok && (
              <a href={settings.contact_socials.tiktok} target="_blank" className="underline">TikTok</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
