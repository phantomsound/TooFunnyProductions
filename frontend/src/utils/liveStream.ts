type LiveStreamMode = "auto" | "force_live" | "force_off";

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseDate = (value: string | undefined | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toMinutes = (ms: number): number => Math.max(0, Math.ceil(ms / 60000));

export type LiveStreamInfo = {
  show: boolean;
  state: "off" | "starting" | "live" | "ending";
  label: string;
  href: string | null;
  minutesUntilStart?: number;
  minutesRemaining?: number;
  youtubeUrl: string;
  radioUrl: string;
  buzzsproutUrl: string;
  podcastUrl: string;
  title: string;
  description: string;
};

export const resolveYouTubeEmbedUrl = (input: string): string | null => {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return `https://www.youtube.com/embed/${last}`;
    }
  } catch {
    return null;
  }
  return null;
};

export const resolveLiveStreamInfo = (settings: Record<string, unknown> | null | undefined): LiveStreamInfo => {
  const source = (settings || {}) as Record<string, unknown>;
  const enabled = source.live_stream_enabled === true;
  const modeRaw = asString(source.live_stream_mode);
  const mode: LiveStreamMode =
    modeRaw === "force_live" ? "force_live" : modeRaw === "force_off" ? "force_off" : "auto";

  const youtubeUrl = asString(source.live_stream_youtube_url).trim();
  const radioUrl = asString(source.live_stream_radio_url).trim();
  const buzzsproutUrl = asString(source.live_stream_buzzsprout_url).trim();
  const podcastUrl = asString(source.live_stream_podcast_url).trim();
  const href = youtubeUrl || radioUrl || buzzsproutUrl || podcastUrl || null;

  const title = asString(source.live_stream_title).trim() || "Live & Streaming";
  const description =
    asString(source.live_stream_description).trim() ||
    "Catch the team live, tune in to the station, or listen to the latest podcast drops.";

  if (!enabled || mode === "force_off") {
    return {
      show: false,
      state: "off",
      label: "",
      href,
      youtubeUrl,
      radioUrl,
      buzzsproutUrl,
      podcastUrl,
      title,
      description,
    };
  }

  if (mode === "force_live") {
    return {
      show: true,
      state: "live",
      label: "Live now",
      href,
      youtubeUrl,
      radioUrl,
      buzzsproutUrl,
      podcastUrl,
      title,
      description,
    };
  }

  const startAt = parseDate(asString(source.live_stream_start_at));
  const endAt = parseDate(asString(source.live_stream_end_at));
  const noticeMinutes = Math.max(0, asNumber(source.live_stream_notice_minutes, 15));
  const now = Date.now();

  if (startAt && endAt) {
    const startMs = startAt.getTime();
    const endMs = endAt.getTime();
    if (now < startMs) {
      const minutesUntilStart = toMinutes(startMs - now);
      if (minutesUntilStart <= noticeMinutes) {
        return {
          show: true,
          state: "starting",
          label: `Going live in ${minutesUntilStart} min`,
          href,
          minutesUntilStart,
          youtubeUrl,
          radioUrl,
          buzzsproutUrl,
          podcastUrl,
          title,
          description,
        };
      }
      return {
        show: false,
        state: "off",
        label: "",
        href,
        youtubeUrl,
        radioUrl,
        buzzsproutUrl,
        podcastUrl,
        title,
        description,
      };
    }

    if (now >= startMs && now <= endMs) {
      const minutesRemaining = toMinutes(endMs - now);
      const isEndingSoon = minutesRemaining <= 15;
      return {
        show: true,
        state: isEndingSoon ? "ending" : "live",
        label: isEndingSoon ? `Live now · ending in ${minutesRemaining} min` : "Live now",
        href,
        minutesRemaining,
        youtubeUrl,
        radioUrl,
        buzzsproutUrl,
        podcastUrl,
        title,
        description,
      };
    }
  }

  return {
    show: enabled,
    state: "live",
    label: "Live now",
    href,
    youtubeUrl,
    radioUrl,
    buzzsproutUrl,
    podcastUrl,
    title,
    description,
  };
};
