// backend/lib/messagingStore.js
// -----------------------------------------------------------------------------
// Lightweight JSON-backed data store for the admin messaging experience.
// Manages conversations, participants, messages, presence, and archival rules.
// -----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const STORE_PATH = join(DATA_DIR, "admin-messaging.json");

const NINETY_DAYS_MS = 1000 * 60 * 60 * 24 * 90;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function coerceString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function coerceEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function coerceObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

function normalizeDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const safe = new Date(value);
  if (Number.isNaN(safe.getTime())) return fallback;
  return safe.toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMessage(input) {
  const record = coerceObject(input);
  const createdAt = normalizeDate(record.created_at);
  return {
    id: coerceString(record.id, randomUUID()),
    conversation_id: coerceString(record.conversation_id),
    created_at: createdAt,
    body: coerceString(record.body),
    sender_email: coerceEmail(record.sender_email),
    sender_name: coerceString(record.sender_name),
    sender_avatar_url: coerceString(record.sender_avatar_url),
    meta: coerceObject(record.meta, {}),
  };
}

function normalizeParticipant(input) {
  const record = coerceObject(input);
  return {
    id: coerceString(record.id, randomUUID()),
    email: coerceEmail(record.email),
    name: coerceString(record.name),
    avatar_url: coerceString(record.avatar_url),
    role: record.role === "admin" ? "admin" : "member",
    joined_at: normalizeDate(record.joined_at),
    last_seen_at: record.last_seen_at ? normalizeDate(record.last_seen_at) : null,
    unread_count: typeof record.unread_count === "number" ? Math.max(record.unread_count, 0) : 0,
  };
}

function normalizeConversation(input) {
  const record = coerceObject(input);
  const createdAt = normalizeDate(record.created_at);
  const updatedAt = normalizeDate(record.updated_at ?? createdAt);
  const messages = Array.isArray(record.messages) ? record.messages.map(normalizeMessage) : [];
  const participants = Array.isArray(record.participants)
    ? record.participants.map(normalizeParticipant)
    : [];

  const lastMessage = messages[messages.length - 1] ?? null;
  const archivedAt = record.archived_at ? normalizeDate(record.archived_at) : null;

  return {
    id: coerceString(record.id, randomUUID()),
    subject: coerceString(record.subject, "Untitled thread"),
    created_at: createdAt,
    updated_at: updatedAt,
    archived_at: archivedAt,
    parent_id: coerceString(record.parent_id || ""),
    participants,
    messages,
    last_message_preview: coerceString(record.last_message_preview, lastMessage?.body || ""),
    last_message_at: lastMessage ? lastMessage.created_at : record.last_message_at ? normalizeDate(record.last_message_at) : updatedAt,
    audit: coerceObject(record.audit, {}),
  };
}

function normalizePresenceMap(input) {
  const source = coerceObject(input, {});
  const entries = Object.entries(source).map(([email, value]) => [coerceEmail(email), coerceObject(value)]);
  return Object.fromEntries(
    entries.map(([email, value]) => [email, { status: value.status === "online" ? "online" : "offline", updated_at: normalizeDate(value.updated_at) }])
  );
}

async function readStore() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const conversations = Array.isArray(parsed?.conversations)
      ? parsed.conversations.map(normalizeConversation)
      : [];
    const presence = normalizePresenceMap(parsed?.presence);
    return { conversations, presence };
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn("⚠️ Failed to read admin messaging store:", err?.message || err);
    }
    return { conversations: [], presence: {} };
  }
}

async function writeStore(state) {
  const payload = {
    conversations: state.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        conversation_id: message.conversation_id,
        created_at: message.created_at,
        body: message.body,
        sender_email: message.sender_email,
        sender_name: message.sender_name,
        sender_avatar_url: message.sender_avatar_url,
        meta: message.meta,
      })),
      participants: conversation.participants.map((participant) => ({
        id: participant.id,
        email: participant.email,
        name: participant.name,
        avatar_url: participant.avatar_url,
        role: participant.role,
        joined_at: participant.joined_at,
        last_seen_at: participant.last_seen_at,
        unread_count: participant.unread_count,
      })),
      audit: conversation.audit,
    })),
    presence: state.presence,
  };

  try {
    await ensureDataDir();
    await writeFile(STORE_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("❌ Failed to persist admin messaging store:", err?.message || err);
  }
}

function archiveExpired(conversations) {
  const cutoff = Date.now() - NINETY_DAYS_MS;
  return conversations.map((conversation) => {
    if (conversation.archived_at) return conversation;
    const lastMessageAt = new Date(conversation.last_message_at).getTime();
    if (!Number.isFinite(lastMessageAt)) return conversation;
    if (lastMessageAt < cutoff) {
      return { ...conversation, archived_at: new Date().toISOString() };
    }
    return conversation;
  });
}

function findConversation(state, conversationId) {
  return state.conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

function attachParticipant(conversation, participant) {
  if (!participant.email) return conversation;
  const existing = conversation.participants.find((item) => item.email === participant.email);
  if (existing) {
    return {
      ...conversation,
      participants: conversation.participants.map((item) =>
        item.email === participant.email
          ? { ...item, name: participant.name || item.name, avatar_url: participant.avatar_url || item.avatar_url }
          : item
      ),
    };
  }
  return {
    ...conversation,
    participants: [...conversation.participants, participant],
  };
}

function markUnread(conversation, senderEmail) {
  return {
    ...conversation,
    participants: conversation.participants.map((participant) => {
      if (participant.email === senderEmail) {
        return { ...participant };
      }
      return { ...participant, unread_count: participant.unread_count + 1 };
    }),
  };
}

function resetUnread(conversation, email) {
  return {
    ...conversation,
    participants: conversation.participants.map((participant) =>
      participant.email === email
        ? { ...participant, unread_count: 0, last_seen_at: new Date().toISOString() }
        : participant
    ),
  };
}

export async function listConversations({ search, archived } = {}) {
  const state = await readStore();
  const archivedCandidates = archiveExpired(state.conversations);
  const changed =
    archivedCandidates.length !== state.conversations.length ||
    archivedCandidates.some(
      (conversation, index) => conversation.archived_at !== state.conversations[index]?.archived_at
    );
  if (changed) {
    state.conversations = archivedCandidates;
    await writeStore(state);
  }

  const normalizedSearch = typeof search === "string" && search.trim().length > 0 ? search.trim().toLowerCase() : null;
  const filterArchived = typeof archived === "boolean" ? archived : null;

  const conversations = state.conversations.filter((conversation) => {
    if (filterArchived !== null) {
      const isArchived = !!conversation.archived_at;
      if (filterArchived !== isArchived) return false;
    }
    if (!normalizedSearch) return true;
    const matchesSubject = conversation.subject.toLowerCase().includes(normalizedSearch);
    const matchesParticipant = conversation.participants.some(
      (participant) =>
        participant.email.includes(normalizedSearch) || participant.name.toLowerCase().includes(normalizedSearch)
    );
    const matchesMessage = conversation.messages.some((message) => message.body.toLowerCase().includes(normalizedSearch));
    return matchesSubject || matchesParticipant || matchesMessage;
  });

  conversations.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  return conversations.map((conversation) => {
    const { messages, ...rest } = conversation;
    return {
      ...rest,
      preview: messages.slice(-1)[0] ?? null,
    };
  });
}

export async function getConversation(conversationId) {
  if (!conversationId) return null;
  const state = await readStore();
  const conversation = findConversation(state, conversationId);
  return conversation ? clone(conversation) : null;
}

function buildConversation({ subject, participants, createdBy, parentId = "" }) {
  const now = new Date().toISOString();
  const normalizedParticipants = Array.isArray(participants) ? participants.map(normalizeParticipant) : [];
  const withCreator = createdBy
    ? attachParticipant(
        {
          id: randomUUID(),
          subject: coerceString(subject, "Untitled thread"),
          created_at: now,
          updated_at: now,
          archived_at: null,
          parent_id: coerceString(parentId),
          participants: [],
          messages: [],
          last_message_preview: "",
          last_message_at: now,
          audit: {},
        },
        normalizeParticipant({ ...createdBy, role: "admin", joined_at: now, unread_count: 0 })
      )
    : null;
  const conversation = withCreator || {
    id: randomUUID(),
    subject: coerceString(subject, "Untitled thread"),
    created_at: now,
    updated_at: now,
    archived_at: null,
    parent_id: coerceString(parentId),
    participants: [],
    messages: [],
    last_message_preview: "",
    last_message_at: now,
    audit: {},
  };
  return normalizedParticipants.reduce((acc, participant) => attachParticipant(acc, participant), conversation);
}

export async function createConversation({ subject, participants = [], createdBy, parentId = "" }) {
  const state = await readStore();
  const conversation = buildConversation({ subject, participants, createdBy, parentId });
  state.conversations = archiveExpired([conversation, ...state.conversations]);
  await writeStore(state);
  return clone(conversation);
}

function makeMessage({ conversation, sender, body, meta }) {
  const now = new Date().toISOString();
  return normalizeMessage({
    id: randomUUID(),
    conversation_id: conversation.id,
    created_at: now,
    body: coerceString(body),
    sender_email: coerceEmail(sender?.email || ""),
    sender_name: coerceString(sender?.name || ""),
    sender_avatar_url: coerceString(sender?.avatar_url || ""),
    meta: meta || {},
  });
}

export async function appendMessage(conversationId, { sender, body, meta, allowRevive = true }) {
  const state = await readStore();
  let conversation = findConversation(state, conversationId);
  if (!conversation) throw new Error("Conversation not found");

  if (conversation.archived_at && allowRevive) {
    const revived = await createConversation({
      subject: conversation.subject,
      participants: conversation.participants,
      createdBy: sender,
      parentId: conversation.id,
    });
    const { conversation: updated, message } = await appendMessage(revived.id, { sender, body, meta, allowRevive: false });
    await markConversationArchived(conversation.id, { archived: true });
    return { conversation: updated, message, revivedFrom: conversation.id };
  }

  const message = makeMessage({ conversation, sender, body, meta });
  conversation = attachParticipant(conversation, normalizeParticipant({ ...sender, joined_at: conversation.created_at, role: "admin" }));
  conversation = markUnread(conversation, message.sender_email);
  conversation = {
    ...conversation,
    messages: [...conversation.messages, message],
    updated_at: message.created_at,
    last_message_preview: message.body,
    last_message_at: message.created_at,
    archived_at: null,
  };

  state.conversations = state.conversations.map((item) => (item.id === conversation.id ? conversation : item));
  await writeStore(state);
  return { conversation: clone(conversation), message: clone(message), revivedFrom: null };
}

export async function markConversationArchived(conversationId, { archived }) {
  const state = await readStore();
  state.conversations = state.conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, archived_at: archived ? new Date().toISOString() : null }
      : conversation
  );
  await writeStore(state);
}

export async function markConversationRead(conversationId, email) {
  const normalizedEmail = coerceEmail(email);
  const state = await readStore();
  let conversation = findConversation(state, conversationId);
  if (!conversation) throw new Error("Conversation not found");
  conversation = resetUnread(conversation, normalizedEmail);
  state.conversations = state.conversations.map((item) => (item.id === conversation.id ? conversation : item));
  await writeStore(state);
  return clone(conversation);
}

export async function getPresence() {
  const state = await readStore();
  return clone(state.presence);
}

export async function setPresence(email, status) {
  const normalizedEmail = coerceEmail(email);
  if (!normalizedEmail) return await getPresence();
  const state = await readStore();
  state.presence[normalizedEmail] = {
    status: status === "online" ? "online" : "offline",
    updated_at: new Date().toISOString(),
  };
  await writeStore(state);
  return clone(state.presence);
}

export async function getUnreadCountsFor(email) {
  const normalizedEmail = coerceEmail(email);
  const state = await readStore();
  const counts = {};
  state.conversations.forEach((conversation) => {
    const participant = conversation.participants.find((item) => item.email === normalizedEmail);
    if (participant && participant.unread_count > 0) {
      counts[conversation.id] = participant.unread_count;
    }
  });
  return counts;
}

export async function searchConversations(term) {
  return listConversations({ search: term });
}

export async function bootstrapMessagingStore() {
  const state = await readStore();
  const archivedCandidates = archiveExpired(state.conversations);
  const changed =
    archivedCandidates.length !== state.conversations.length ||
    archivedCandidates.some(
      (conversation, index) => conversation.archived_at !== state.conversations[index]?.archived_at
    );
  if (changed) {
    state.conversations = archivedCandidates;
    await writeStore(state);
  }
}

