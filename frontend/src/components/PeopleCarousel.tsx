import React from "react";
import { resolveMediaUrl } from "../utils/media";
import { PeopleProfile, resolveCarouselText } from "../utils/people";

const formatSocialLabel = (label: string, url: string): string => {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  const cleaned = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return cleaned || "Link";
};

type PeopleCarouselProps = {
  title: string;
  description?: string;
  people: PeopleProfile[];
  className?: string;
};

export default function PeopleCarousel({ title, description, people, className }: PeopleCarouselProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const handleScroll = (direction: "prev" | "next") => {
    const node = scrollRef.current;
    if (!node) return;
    const amount = node.clientWidth * 0.8;
    node.scrollBy({
      left: direction === "next" ? amount : -amount,
      behavior: "smooth",
    });
  };

  if (!people || people.length === 0) return null;

  const minCarouselItems = 6;
  const repeatCount = Math.max(1, Math.ceil(minCarouselItems / people.length));
  const carouselEntries = Array.from({ length: repeatCount }).flatMap((_, repeatIndex) =>
    people.map((person, index) => ({
      person,
      key: `${person.id || person.name || "person"}-${index}-repeat-${repeatIndex}`,
    }))
  );

  const containerClassName = `rounded-3xl border border-theme-surface bg-theme-surface p-6 shadow-lg sm:p-7 ${className ?? ""}`.trim();

  return (
    <section className={containerClassName}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-theme-accent">{title}</h2>
          {description ? <p className="text-sm text-theme-muted">{description}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleScroll("prev")}
            className="rounded-full border border-theme-surface bg-theme-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-theme-muted transition hover:border-theme-accent hover:text-theme-accent"
            aria-label="Scroll people carousel backward"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => handleScroll("next")}
            className="rounded-full border border-theme-surface bg-theme-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-theme-muted transition hover:border-theme-accent hover:text-theme-accent"
            aria-label="Scroll people carousel forward"
          >
            Next
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-6 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4"
      >
        {carouselEntries.map(({ person, key }) => {
          const photoUrl = resolveMediaUrl(person.photo_url);
          const hasPhoto = Boolean(photoUrl);
          const carouselText = resolveCarouselText(person);
          const socials = person.socials.filter((social) => social.show_in_carousel && social.url.trim());

          return (
            <article
              key={key}
              className="min-w-[250px] snap-start rounded-2xl border border-theme-surface bg-theme-background p-4 sm:min-w-[280px]"
            >
              {hasPhoto ? (
                <img
                  src={photoUrl}
                  alt={person.name || "Team member"}
                  className="mb-4 h-56 w-full rounded-xl object-cover"
                />
              ) : (
                <div className="mb-4 flex h-56 w-full items-center justify-center rounded-xl bg-theme-surface text-xs text-theme-muted">
                  Add a photo to feature this team member.
                </div>
              )}

              <h3 className="text-lg font-semibold text-theme-base">{person.name || "Team member"}</h3>
              {person.title ? <p className="text-sm text-theme-muted">{person.title}</p> : null}
              {carouselText ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-theme-muted">{carouselText}</p>
              ) : null}

              {socials.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {socials.map((social, socialIndex) => (
                    <a
                      key={`${social.url}-${socialIndex}`}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-theme-accent hover:text-theme-accent"
                    >
                      {formatSocialLabel(social.label, social.url)}
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
