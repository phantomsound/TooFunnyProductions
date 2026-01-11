import React, { useMemo } from "react";
import PageContainer from "../components/PageContainer";
import PeopleCarousel from "../components/PeopleCarousel";
import { useSettings } from "../lib/SettingsContext";
import { resolveMediaUrl } from "../utils/media";
import { resolvePeopleFromSettings } from "../utils/people";
import { resolveLiveStreamInfo, resolveYouTubeEmbedUrl } from "../utils/liveStream";

const isArchiveTitle = (value: unknown): boolean =>
  typeof value === "string" && value.trim().toLowerCase() === "archive";

export default function Media() {
  const { settings } = useSettings();
  const sections = Array.isArray(settings?.media_sections) ? settings.media_sections : [];
  // section: { title: string, items: [{type:"video"|"image", url, title?}] }
  const title = typeof settings?.media_title === "string" ? settings.media_title : "Media";
  const intro =
    typeof settings?.media_intro === "string"
      ? settings.media_intro
      : "Watch our latest sketches, clips, and behind-the-scenes footage.";

  const people = useMemo(() => resolvePeopleFromSettings(settings), [settings]);
  const mediaPeople = useMemo(() => people.filter((person) => person.show_on_media), [people]);
  const liveStream = useMemo(() => resolveLiveStreamInfo(settings), [settings]);
  const youTubeEmbed = useMemo(
    () => resolveYouTubeEmbedUrl(liveStream.youtubeUrl),
    [liveStream.youtubeUrl]
  );
  const hasStreamingSection =
    Boolean(liveStream.youtubeUrl || liveStream.radioUrl || liveStream.buzzsproutUrl || liveStream.podcastUrl);

  const visibleSections = useMemo(
    () => sections.filter((section: any) => section && !isArchiveTitle(section.title)),
    [sections]
  );

  return (
    <PageContainer className="text-theme-base">
      <h1 className="mb-3 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-8 whitespace-pre-wrap break-words text-theme-muted">{intro}</p>

      {hasStreamingSection ? (
        <section className="mt-8 rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-theme-accent">{liveStream.title}</h2>
              <p className="text-sm text-theme-muted">{liveStream.description}</p>
            </div>
            {liveStream.show && liveStream.href ? (
              <a
                href={liveStream.href}
                target="_blank"
                rel="noopener noreferrer"
                className="theme-accent-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]"
              >
                <span className="inline-flex h-2 w-2 rounded-full bg-red-500 tf-live-pulse" />
                {liveStream.label}
              </a>
            ) : null}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {liveStream.youtubeUrl ? (
              <div className="rounded-2xl border border-theme-surface bg-theme-background p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-theme-accent-soft">
                  YouTube Live
                </h3>
                {youTubeEmbed ? (
                  <div className="mt-3 aspect-video overflow-hidden rounded-xl border border-theme-surface">
                    <iframe
                      title="YouTube Live stream"
                      src={youTubeEmbed}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <a
                    href={liveStream.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-theme-accent hover:text-theme-accent"
                  >
                    Open YouTube Live
                    <span aria-hidden>→</span>
                  </a>
                )}
              </div>
            ) : null}

            {liveStream.radioUrl ? (
              <div className="rounded-2xl border border-theme-surface bg-theme-background p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-theme-accent-soft">Radio.co</h3>
                <div className="mt-3 overflow-hidden rounded-xl border border-theme-surface bg-theme-surface">
                  <iframe title="Radio.co player" src={liveStream.radioUrl} className="h-40 w-full" />
                </div>
                <a
                  href={liveStream.radioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-theme-accent hover:text-theme-accent"
                >
                  Open station
                  <span aria-hidden>→</span>
                </a>
              </div>
            ) : null}

            {liveStream.buzzsproutUrl || liveStream.podcastUrl ? (
              <div className="rounded-2xl border border-theme-surface bg-theme-background p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-theme-accent-soft">Podcasts</h3>
                <div className="mt-3 space-y-3 text-sm text-theme-muted">
                  {liveStream.buzzsproutUrl ? (
                    <a
                      href={liveStream.buzzsproutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-semibold text-theme-accent hover:text-theme-accent"
                    >
                      Listen on Buzzsprout
                      <span aria-hidden>→</span>
                    </a>
                  ) : null}
                  {liveStream.podcastUrl ? (
                    <a
                      href={liveStream.podcastUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-semibold text-theme-accent hover:text-theme-accent"
                    >
                      More podcast options
                      <span aria-hidden>→</span>
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <PeopleCarousel
        title="Featured Team"
        description="Spotlight the performers and creators behind our latest media."
        people={mediaPeople}
        className="mt-6"
      />

      {visibleSections.map((s: any, idx: number) => (
        <div key={idx} className="mb-10">
          <h2 className="mb-4 text-2xl font-semibold text-theme-accent">{s.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(s.items || []).map((it: any, i: number) => {
              const mediaUrl = resolveMediaUrl(it?.url);
              const isVideo = it?.type === "video";
              const hasMedia = Boolean(mediaUrl);

              return (
                <div key={i} className="rounded border border-theme-surface bg-theme-surface p-3">
                  {hasMedia ? (
                    isVideo ? (
                      <div className="aspect-video mb-2 w-full overflow-hidden rounded">
                        <video src={mediaUrl} controls preload="metadata" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <img src={mediaUrl} alt={it?.title || ""} className="mb-2 h-48 w-full rounded object-cover" />
                    )
                  ) : (
                    <div className="flex h-48 w-full items-center justify-center rounded bg-theme-background text-xs text-theme-muted">
                      Media coming soon.
                    </div>
                  )}
                  {it?.title && <div className="break-words text-sm text-theme-muted">{it.title}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {visibleSections.length === 0 && <div className="text-theme-muted">No media yet.</div>}
    </PageContainer>
  );
}
