export type PeopleSocialLink = {
  label: string;
  url: string;
  show_in_carousel: boolean;
};

export type PeopleProfile = {
  id: string;
  name: string;
  title: string;
  bio: string;
  photo_url: string;
  socials: PeopleSocialLink[];
  show_on_home: boolean;
  show_on_media: boolean;
  carousel_text_mode: "about" | "custom";
  carousel_text: string;
};

const MAX_SOCIAL_LINKS = 10;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const toBool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const sanitizeSocials = (value: unknown): PeopleSocialLink[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      return {
        label: asString(obj.label),
        url: asString(obj.url),
        show_in_carousel: toBool(obj.show_in_carousel, true),
      };
    })
    .slice(0, MAX_SOCIAL_LINKS);
};

export const sanitizePeopleProfiles = (value: unknown): PeopleProfile[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      const rawMode = asString(obj.carousel_text_mode).toLowerCase();
      const carouselTextMode = rawMode === "custom" ? "custom" : "about";
      return {
        id: asString(obj.id),
        name: asString(obj.name),
        title: asString(obj.title),
        bio: asString(obj.bio),
        photo_url: asString(obj.photo_url),
        socials: sanitizeSocials(obj.socials),
        show_on_home: toBool(obj.show_on_home, false),
        show_on_media: toBool(obj.show_on_media, false),
        carousel_text_mode: carouselTextMode,
        carousel_text: asString(obj.carousel_text),
      };
    });
};

export const resolveCarouselText = (person: PeopleProfile): string => {
  if (person.carousel_text_mode === "custom") {
    const custom = person.carousel_text.trim();
    if (custom) return custom;
  }
  return person.bio.trim();
};

export const resolvePeopleFromSettings = (settings: Record<string, unknown> | null | undefined): PeopleProfile[] => {
  if (!settings) return [];
  const people = sanitizePeopleProfiles(settings.people_profiles);
  if (people.length > 0) return people;
  const legacyTeam = Array.isArray(settings.about_team) ? settings.about_team : [];
  if (legacyTeam.length === 0) return [];

  return legacyTeam
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const obj = entry as Record<string, unknown>;
      return {
        id: asString(obj.id) || `legacy-${index}`,
        name: asString(obj.name),
        title: asString(obj.title),
        bio: asString(obj.bio),
        photo_url: asString(obj.photo_url),
        socials: sanitizeSocials(obj.socials),
        show_on_home: false,
        show_on_media: false,
        carousel_text_mode: "about",
        carousel_text: "",
      };
    });
};
