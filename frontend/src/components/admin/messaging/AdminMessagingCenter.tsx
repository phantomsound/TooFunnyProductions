import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../lib/api";
import { useSettings } from "../../../lib/SettingsContext";
import useAuth from "../../../hooks/useAuth";

type PresenceMap = Record<string, { status: "online" | "offline"; updated_at: string }>;

type MessageRecord = {
  id: string;
  conversation_id: string;
  created_at: string;
  body: string;
  sender_email: string;
  sender_name: string;
  sender_avatar_url: string;
};

type Participant = {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  role: string;
  joined_at: string;
  last_seen_at: string | null;
  unread_count: number;
};

type ConversationSummary = {
  id: string;
  subject: string;
  archived_at: string | null;
  last_message_at: string;
  preview?: MessageRecord | null;
};

type ConversationDetail = ConversationSummary & {
  participants: Participant[];
  messages: MessageRecord[];
};

type RosterProfile = {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
};

const bubbleButtonClasses =
  "group fixed bottom-6 right-6 z-30 flex items-center gap-3 rounded-full bg-blue-500 px-4 py-3 text-white shadow-lg shadow-blue-500/40 transition hover:bg-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-300";

const overlayClasses =
  "fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm px-4 py-6 md:items-center";

function formatRelativeTime(iso: string) {
  const now = Date.now();
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return "";
  const diff = now - value;
  const minute = 60 * 1000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return "Just now";
  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute));
    return `${minutes}m ago`;
  }
  if (diff < day) {
    const hours = Math.round(diff / hour);
    return `${hours}h ago`;
  }
  const days = Math.round(diff / day);
  return `${days}d ago`;
}

const sanitizeRoster = (input: unknown): RosterProfile[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const profiles: RosterProfile[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const email = typeof record.email === "string" ? record.email.toLowerCase() : "";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    profiles.push({
      id: typeof record.id === "string" ? record.id : email,
      name: typeof record.name === "string" ? record.name : email,
      email,
      avatar_url: typeof record.avatar_url === "string" ? record.avatar_url : "",
    });
  }
  return profiles;
};

const emptyPresence: PresenceMap = {};

export default function AdminMessagingCenter(): JSX.Element {
  const { settings } = useSettings();
  const { user } = useAuth();

  const roster = useMemo(() => sanitizeRoster(settings?.admin_profiles), [settings?.admin_profiles]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationDetail | null>(null);
  const [presence, setPresence] = useState<PresenceMap>(emptyPresence);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const me = (user?.email || "").toLowerCase();

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const term = search.trim().toLowerCase();
    return conversations.filter((conversation) =>
      conversation.subject.toLowerCase().includes(term) || conversation.preview?.body.toLowerCase().includes(term)
    );
  }, [conversations, search]);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const abortController = new AbortController();
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch(api("/api/admin/messaging/conversations"), {
          credentials: "include",
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(`Failed to fetch conversations (${response.status})`);
        const payload: { conversations: ConversationSummary[] } = await response.json();
        setConversations(payload.conversations || []);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error(err);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => abortController.abort();
  }, [open]);

  const fetchConversation = useCallback(async (id: string) => {
    try {
      const response = await fetch(api(`/api/admin/messaging/conversations/${id}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Failed to load conversation (${response.status})`);
      const payload: { conversation: ConversationDetail } = await response.json();
      const previewMessage = payload.conversation.messages[payload.conversation.messages.length - 1] ?? null;
      const withPreview: ConversationDetail = { ...payload.conversation, preview: previewMessage };
      setActiveConversation(withPreview);
      setConversations((prev) => {
        const next = prev.map((conv) =>
          conv.id === id
            ? { ...conv, preview: previewMessage, last_message_at: payload.conversation.last_message_at }
            : conv
        );
        return next.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      });
      scrollToBottom();
    } catch (err) {
      console.error(err);
    }
  }, [scrollToBottom]);

  const markRead = useCallback(async (id: string) => {
    try {
      await fetch(api(`/api/admin/messaging/conversations/${id}/read`), {
        method: "POST",
        credentials: "include",
      });
      setUnread((prev) => ({ ...prev, [id]: 0 }));
    } catch (err) {
      console.warn("Failed to mark conversation read", err);
    }
  }, []);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      await fetchConversation(id);
      await markRead(id);
    },
    [fetchConversation, markRead]
  );

  useEffect(() => {
    if (open && filteredConversations.length > 0 && !activeId) {
      handleSelectConversation(filteredConversations[0].id);
    }
  }, [open, filteredConversations, activeId, handleSelectConversation]);

  useEffect(() => {
    if (!open) return;
    const socketUrl = api("/api/admin/messaging/ws").replace(/^http/, "ws");
    const ws = new WebSocket(socketUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "init") {
          setPresence(message.payload.presence || emptyPresence);
          setUnread(message.payload.unread || {});
        } else if (message.type === "presence") {
          setPresence((prev) => ({ ...prev, [message.payload.email]: { status: message.payload.status, updated_at: message.payload.updated_at } }));
        } else if (message.type === "unread") {
          setUnread(message.payload.unread || {});
        } else if (message.type === "message") {
          const summary: ConversationSummary = {
            id: message.payload.conversation.id,
            subject: message.payload.conversation.subject,
            archived_at: message.payload.conversation.archived_at,
            last_message_at: message.payload.conversation.last_message_at,
            preview: message.payload.message,
          };

          setConversations((prev) => {
            const exists = prev.find((item) => item.id === summary.id);
            let next: ConversationSummary[];
            if (exists) {
              next = prev.map((item) => (item.id === summary.id ? summary : item));
            } else {
              next = [summary, ...prev];
            }
            if (message.payload.revivedFrom) {
              next = next.filter((item) => item.id !== message.payload.revivedFrom);
            }
            return next.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          });

          if (activeId === summary.id) {
            fetchConversation(summary.id);
            markRead(summary.id);
          }
        }
      } catch (err) {
        console.warn("Failed to parse messaging socket payload", err);
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "presence", status: "online" }));
    };

    ws.onerror = (err) => {
      console.warn("Admin messaging socket error", err);
    };

    return () => {
      ws.close(1000, "Admin messaging panel closed");
      wsRef.current = null;
    };
  }, [open, fetchConversation, activeId]);

  useEffect(() => {
    if (!open) return;
    const presencePing = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "presence", status: "online" }));
      }
    }, 60000);
    return () => clearInterval(presencePing);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const loadPresence = async () => {
      try {
        const response = await fetch(api("/api/admin/messaging/presence"), { credentials: "include" });
        if (!response.ok) return;
        const payload: { presence: PresenceMap } = await response.json();
        setPresence(payload.presence || emptyPresence);
      } catch (err) {
        console.warn("Failed to fetch presence", err);
      }
    };
    loadPresence();
  }, [open]);

  useEffect(() => {
    if (activeConversation) {
      scrollToBottom();
    }
  }, [activeConversation, scrollToBottom]);

  const handleSend = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!activeId || !composerValue.trim()) return;
      setSending(true);
      try {
        const response = await fetch(api(`/api/admin/messaging/conversations/${activeId}/messages`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: composerValue }),
        });
        if (!response.ok) throw new Error(`Failed to send message (${response.status})`);
        const payload: { conversation: ConversationDetail; message: MessageRecord } = await response.json();
        setComposerValue("");
        setActiveConversation({ ...payload.conversation, preview: payload.message });
        setConversations((prev) => {
          const next = prev.map((item) =>
            item.id === payload.conversation.id
              ? {
                  ...item,
                  preview: payload.message,
                  last_message_at: payload.conversation.last_message_at,
                }
              : item
          );
          return next.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
        });
        scrollToBottom();
      } catch (err) {
        console.error(err);
      } finally {
        setSending(false);
      }
    },
    [activeId, composerValue, scrollToBottom]
  );

  if (!me) return <></>;

  const activeRoster = roster.map((profile) => ({
    ...profile,
    status: presence[profile.email]?.status ?? "offline",
  }));

  const unreadTotal = Object.values(unread).reduce((sum, value) => sum + (value || 0), 0);

  return (
    <>
      <button type="button" className={bubbleButtonClasses} onClick={() => setOpen(true)}>
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-blue-500 shadow-inner shadow-blue-500/30">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
          >
            <path d="M12 3C6.477 3 2 6.978 2 12c0 2.063.756 3.977 2.045 5.5L2 22l4.828-1.793C8.042 21.386 9.94 22 12 22c5.523 0 10-3.978 10-9s-4.477-10-10-10Zm0 16c-1.795 0-3.465-.508-4.866-1.377l-.51-.312-1.812.674.646-1.88-.33-.506C4.444 14.776 4 13.434 4 12c0-4.065 3.589-7 8-7s8 2.935 8 7-3.589 7-8 7Zm1-6h-2v2h2v-2Zm0-6h-2v5h2V7Z" />
          </svg>
          {unreadTotal > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          ) : null}
        </span>
        <span className="hidden text-left text-sm font-semibold leading-tight md:block">
          Admin Messages
          <span className="block text-xs font-normal text-blue-100/90">Stay in sync with your team</span>
        </span>
      </button>

      {open ? (
        <div className={overlayClasses}>
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/95 text-neutral-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
              <div>
                <h2 className="text-lg font-semibold text-yellow-200">Admin Messages</h2>
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Real-time team chat & presence</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-neutral-700 p-2 text-neutral-400 transition hover:text-white"
              >
                <span className="sr-only">Close</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 flex-col md:flex-row">
              <aside className="flex h-[280px] flex-none flex-col border-b border-neutral-900 px-4 py-4 md:h-auto md:w-72 md:border-b-0 md:border-r">
                <div className="mb-4 flex flex-wrap gap-2">
                  {activeRoster.length === 0 ? (
                    <span className="text-xs text-neutral-500">Add admin profiles in General Settings to populate the roster.</span>
                  ) : (
                    activeRoster.map((profile) => (
                      <span
                        key={profile.id}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                          profile.status === "online"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-neutral-800 text-neutral-400"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            profile.status === "online" ? "bg-emerald-400" : "bg-neutral-500"
                          }`}
                        />
                        {profile.name || profile.email}
                      </span>
                    ))
                  )}
                </div>

                <div className="mb-3">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search threads"
                    className="w-full rounded-full border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
                  />
                </div>

                <div className="flex-1 overflow-y-auto pr-1">
                  {loading ? (
                    <div className="py-8 text-center text-sm text-neutral-400">Loading conversations…</div>
                  ) : filteredConversations.length === 0 ? (
                    <div className="py-8 text-center text-sm text-neutral-400">No conversations yet.</div>
                  ) : (
                    <ul className="space-y-2">
                      {filteredConversations.map((conversation) => {
                        const isActive = activeId === conversation.id;
                        const unreadCount = unread[conversation.id] || 0;
                        return (
                          <li key={conversation.id}>
                            <button
                              type="button"
                              onClick={() => handleSelectConversation(conversation.id)}
                              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                                isActive
                                  ? "border-yellow-400/60 bg-yellow-400/10 text-yellow-100"
                                  : "border-transparent bg-neutral-900/70 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.2em]">
                                <span>{formatRelativeTime(conversation.last_message_at)}</span>
                                {unreadCount > 0 ? (
                                  <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 truncate text-sm font-semibold">{conversation.subject}</div>
                              <div className="mt-1 line-clamp-2 text-xs text-neutral-400">
                                {conversation.preview?.body || "No messages yet"}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </aside>

              <section className="flex min-h-[280px] flex-1 flex-col bg-neutral-950/70">
                {activeConversation ? (
                  <>
                    <header className="border-b border-neutral-900 px-6 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-yellow-200">{activeConversation.subject}</h3>
                          <p className="text-xs text-neutral-400">Last message {formatRelativeTime(activeConversation.last_message_at)}</p>
                        </div>
                        <div className="flex -space-x-2">
                          {activeConversation.participants
                            .filter((participant) => participant.email !== me)
                            .slice(0, 3)
                            .map((participant) => (
                              <span
                                key={participant.id}
                                className="h-8 w-8 overflow-hidden rounded-full border border-neutral-900 bg-neutral-800"
                                title={participant.name || participant.email}
                              >
                                {participant.avatar_url ? (
                                  <img src={participant.avatar_url} alt={participant.name || participant.email} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-neutral-300">
                                    {participant.name ? participant.name.charAt(0).toUpperCase() : participant.email.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </span>
                            ))}
                        </div>
                      </div>
                    </header>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      <div className="space-y-4">
                        {activeConversation.messages.map((message) => {
                          const isMine = message.sender_email === me;
                          return (
                            <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow ${
                                  isMine
                                    ? "bg-blue-500 text-white shadow-blue-500/40"
                                    : "bg-neutral-900/80 text-neutral-100 shadow-neutral-900/40"
                                }`}
                              >
                                <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-neutral-300">
                                  <span>{message.sender_name || message.sender_email}</span>
                                  <span className="text-[10px] text-neutral-200/80">{formatRelativeTime(message.created_at)}</span>
                                </div>
                                <div>{message.body}</div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    </div>

                    <footer className="border-t border-neutral-900 bg-neutral-950/70 px-6 py-4">
                      <form onSubmit={handleSend} className="flex flex-col gap-3 md:flex-row md:items-end">
                        <textarea
                          value={composerValue}
                          onChange={(event) => setComposerValue(event.target.value)}
                          className="min-h-[80px] flex-1 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-yellow-300 focus:outline-none focus:ring-0"
                          placeholder="Type a reply to your team…"
                          disabled={sending}
                        />
                        <button
                          type="submit"
                          disabled={sending || !composerValue.trim()}
                          className="inline-flex h-11 items-center justify-center rounded-full bg-yellow-400 px-6 text-sm font-semibold text-black shadow-lg shadow-yellow-400/40 transition hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {sending ? "Sending…" : "Send"}
                        </button>
                      </form>
                    </footer>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
                    Select a conversation to get started.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

