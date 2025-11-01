import React from "react";
import PageContainer from "../components/PageContainer";
import { useSettings } from "../lib/SettingsContext";
import { resolveMediaUrl } from "../utils/media";

type TeamSocialLink = {
  label: string;
  url: string;
};

const MAX_TEAM_SOCIAL_LINKS = 10;

const toSocialLinks = (value: unknown): TeamSocialLink[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const obj = entry as Record<string, unknown>;
        const url = typeof obj.url === "string" ? obj.url.trim() : "";
        if (!url) return null;
        const label = typeof obj.label === "string" ? obj.label.trim() : "";
        return { label, url };
      })
      .filter((link): link is TeamSocialLink => Boolean(link))
      .slice(0, MAX_TEAM_SOCIAL_LINKS);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([rawLabel, rawUrl]) => {
        if (typeof rawUrl !== "string") return null;
        const url = rawUrl.trim();
        if (!url) return null;
        const label = typeof rawLabel === "string" ? rawLabel.trim() || rawLabel : String(rawLabel);
        return { label, url };
      })
      .filter((link): link is TeamSocialLink => Boolean(link))
      .slice(0, MAX_TEAM_SOCIAL_LINKS);
  }

  return [];
};

const formatSocialLabel = (link: TeamSocialLink): string => {
  const trimmed = link.label?.trim();
  if (trimmed) return trimmed;
  const cleaned = link.url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return cleaned || "Link";
};

export default function About() {
  const { settings } = useSettings();
  const title = typeof settings?.about_title === "string" ? settings.about_title : "About Too Funny";
  const body =
    typeof settings?.about_body === "string"
      ? settings.about_body
      : "We make original sketches, live shows, and more.";
  const missionTitle =
    typeof settings?.about_mission_title === "string" ? settings.about_mission_title : "Our Mission";
  const missionBody =
    typeof settings?.about_mission_body === "string"
      ? settings.about_mission_body
      : "Bring people together through original comedy that is Too Funny to forget.";
  const teamIntro =
    typeof settings?.about_team_intro === "string"
      ? settings.about_team_intro
      : "Meet the collaborators bringing the chaos to life.";

  const team = Array.isArray(settings?.about_team) ? settings.about_team : [];

  return (
    <PageContainer className="text-theme-base">
      <h1 className="mb-6 text-3xl font-bold text-theme-accent">{title}</h1>
      <p className="mb-10 whitespace-pre-wrap break-words text-theme-muted">{body}</p>

      <section className="mb-12 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-theme-surface bg-theme-surface p-6">
          <h2 className="mb-2 text-2xl font-semibold text-theme-accent">{missionTitle}</h2>
          <p className="whitespace-pre-wrap break-words text-theme-muted">{missionBody}</p>
        </div>
        <div className="rounded-2xl border border-theme-surface bg-theme-surface p-6">
          <h3 className="mb-2 text-xl font-semibold text-theme-accent">What drives us</h3>
          <p className="break-words text-theme-muted">
            Too Funny Productions is a collaborative crew of comedians, directors, editors, and techs obsessed with creating
            unforgettable sketch and improv experiences.
          </p>
        </div>
      </section>

      <h2 className="mb-2 text-2xl font-semibold text-theme-accent">Meet the Team</h2>
      <p className="mb-6 whitespace-pre-wrap break-words text-theme-muted">{teamIntro}</p>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {team.map((m: any, i: number) => {
          const photoUrl = resolveMediaUrl(m?.photo_url);
          const hasPhoto = Boolean(photoUrl);
          const socialLinks = toSocialLinks(m?.socials);

          return (
            <div key={i} className="rounded-lg border border-theme-surface bg-theme-surface p-4">
              {hasPhoto ? (
                <img src={photoUrl} alt={m?.name || "Team member"} className="mb-3 h-48 w-full rounded object-cover" />
              ) : (
                <div className="mb-3 flex h-48 w-full items-center justify-center rounded bg-theme-background text-xs text-theme-muted">
                  Add a team photo to highlight this member.
                </div>
              )}

              <div className="text-lg font-semibold text-theme-base">{m.name}</div>
              <div className="text-sm text-theme-muted">{m.title}</div>
              {m.bio ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-theme-muted">{m.bio}</p> : null}
              {socialLinks.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {socialLinks.map((link, linkIndex) => {
                    const label = formatSocialLabel(link);
                    return (
                      <a
                        key={`${link.url}-${linkIndex}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-theme-accent hover:text-theme-accent"
                      >
                        {label}
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </PageContainer>
  );
}
