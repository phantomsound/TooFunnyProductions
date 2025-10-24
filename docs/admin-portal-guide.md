# Too Funny Productions Admin Guide

## 1. Overview
The admin dashboard (`/admin`) lets allow-listed Google accounts manage public site content, media assets, and publishing workflows without touching code. This guide covers the tools available in each section and the standard editing flow so your team can safely collaborate on updates.

## 2. Access & Roles
- **Sign in with Google:** Visiting `/admin` prompts users to sign in. Only emails on the allowlist (see Section 7) or configured in the environment can pass the `AdminGuard`. Others will see the "Admin access required" screen with a sign-in button.
- **User bar:** Once signed in, the top-right user menu displays the active account, draft/live stage indicator, and a sign-out action.
- **Session timeout:** Draft sessions automatically time out based on the "Admin Session Timeout" setting (Section 5.5). Sign in again to continue.

## 3. Layout & Navigation
- **Sidebar:** Fixed links for the four admin modules—General Settings, Page Configurations, Media Manager, and Audit Log. Active sections highlight in yellow.
- **Quick Links:** Up to four shortcuts appear under the navigation. Configure them in **General Settings → Admin Quick Links**.
- **Mobile view:** On small screens, open the hamburger menu to reveal navigation and quick links.
- **Content area:** All editors open inside the main panel. Most pages share the same draft controls described below.

## 4. Draft Workflow & Publishing
Content edits always happen on the **Draft** stage, then move to **Live** once reviewed.

### 4.1 Stage selector
Use the dropdown at the top of General Settings to switch between **Live** (read-only preview) and **Draft** (editable). All inputs disable automatically when viewing Live or when another editor owns the draft lock.

### 4.2 Draft locking
- **Acquire lock:** Click **Acquire** before making changes to prevent collisions. Only available while viewing Draft.
- **Release lock:** When finished, click **Release** so teammates can edit.
- **Status indicator:** Shows whether you hold the lock, another editor does, or no lock exists. Errors appear in red if a lock request fails.

### 4.3 Saving & syncing
- **Save Draft:** Persists your pending changes to the Draft stage. Enabled only when Draft is dirty and unlocked.
- **Pull Current Live:** Copies Live content into Draft without publishing—useful to reset the draft before editing.
- **Preview Draft:** Opens the public site with `?stage=draft` so you can review in context.
- **Snapshots:** Opens the draft snapshots modal. From there you can save labeled checkpoints, restore a previous version (overwrites the current draft), or delete snapshots you no longer need.

### 4.4 Publishing
When Draft is ready, click **Publish to Live**. This copies the draft values to the Live stage. Ensure you hold the lock and have saved the latest edits first.

### 4.5 Draft snapshots & recovery
The **Snapshots** modal lets you:
- Save up to the 20 most recent snapshots (label optional).
- Restore a snapshot back into Draft after confirming the overwrite prompt. The system reloads settings and reacquires the lock for you.
- Delete outdated snapshots. Actions are audited and require confirmation.

### 4.6 Draft safety tips
- Save frequently and release the lock when idle.
- Coordinate larger changes by naming snapshots (e.g., "Spring homepage refresh").
- Use Pull Current Live to recover from accidental edits.

## 5. General Settings Module
This section controls global branding, theming, footer content, maintenance windows, quick links, and session policies.

### 5.1 Branding & SEO
- **Site title, description, keywords:** Update copy displayed in metadata and search engines.
- **Logo & favicon uploads:** Use the built-in uploader to pick images from the media bucket or upload new ones.

### 5.2 Footer & quick links
- **Footer text:** Short copyright or tagline message.
- **Footer links:** Manage label + URL pairs for the public footer.
- **Admin Quick Links:** Configure up to four shortcuts shown in the admin sidebar (handy for support docs or monitoring tools).

### 5.3 Global theming
- **Accent, background, header, and footer colors:** Adjust primary brand colors.
- **Use global theme toggle:** When enabled, page-level theme overrides inherit these values. Disable it to allow per-page color palettes (see Section 6.2).

### 5.4 Maintenance mode
- **Manual toggle + message:** Enable a maintenance banner and customize the message.
- **Scheduled window:** Optional daily window with start/end times and timezone.

### 5.5 Session policy
Choose an admin inactivity timeout (5–60 minutes). Sessions exceeding this limit will be asked to sign in again.

## 6. Page Configurations Module
Select **Page Configurations** in the sidebar to edit per-page content. Every page shares the Draft controls and adds its own theme override block at the bottom so you can customize accent/background colors without affecting global settings.

### 6.1 Home
- **Hero section:** Title, subtext, highlight badge (toggle, label, size, colors), and hero background image.
- **Featured video:** Paste a video URL or pick from the media library.
- **"Who We Are" section:** Title, body copy, optional label badge, CTA button text + link, supporting image, and typography sizing options.

### 6.2 About
- **Intro & mission:** Headline, intro paragraph, mission heading, and mission body.
- **Team listing:** Add, reorder, or remove members. For each, upload a portrait, set name/title, bio, pronouns badge, and social links (Instagram, Twitter/X, YouTube, TikTok, website, Linktree). Use the move up/down buttons to control display order.

### 6.3 Events
- **Page title & intro copy.**
- **Upcoming events:** Add rows with title, date, venue, and ticket link. URLs auto-normalize to include HTTPS.
- **Past events:** Same editor for archived shows. Remove entries you no longer want to display.

### 6.4 Media
- **Hero copy:** Intro title and paragraph for the media page.
- **Featured videos & galleries:** Manage lists of video embeds and image grids. Each item supports title, description, URL, and thumbnail where applicable.
- **Layout toggles:** Control section visibility and ordering (e.g., hide image gallery).

### 6.5 Merch
- **Headline & intro.**
- **Product cards:** Add/edit items with name, description, price, image, purchase link, and optional badge (e.g., "New").
- **Purchase links:** Automatically normalized to full URLs.

### 6.6 Contact
- **Hero copy:** Headline, subheading, and supporting text.
- **Contact cards:** Configure multiple cards with label, description, button text/link, and icon.
- **Social links:** Provide URLs for key platforms; icons render automatically on the public page.

## 7. Admin Access (Allowlist Manager)
Located beneath General Settings, this tool lets you manage which Google accounts can reach the dashboard.
- **Editable allowlist:** Add addresses one per line. Press **Enter** or click **Add** to queue them before saving.
- **Environment emails:** Read-only addresses configured by developers. They always retain access even if not listed in the editable section.
- **Save changes:** Click **Save allowlist** to persist updates. Success and error banners appear inline.
- **Remove:** Use the **Remove** button next to an address to revoke access. Changes apply on the next login.

## 8. Media Manager Module
A standalone media library for the Supabase storage bucket.
- **Upload:** Click **Upload files** and select one or more assets. Upload progress disables the button until complete.
- **Search & sort:** Filter by filename and sort by newest, oldest, name, or size.
- **Copy URL:** Use the copy icon to place the public asset URL on your clipboard (fallback prompt appears if clipboard access fails).
- **Rename:** Prompt-based rename that keeps file type extensions intact.
- **Delete:** Permanently remove files after confirmation. Deleted assets disappear from the list immediately.

## 9. Audit Log Module
Review a searchable history of admin actions, publishes, uploads, and snapshot events.
- **Filters:** Search text, filter by actor email, action type, result limit, and newest/oldest ordering.
- **Refresh:** Reload data on demand; auto-refresh also runs shortly after you change filters.
- **Details:** Each row shows timestamp, actor, action badge, and JSON-formatted metadata for troubleshooting.
- **Reset:** Clear all filters with the **Reset** button.

## 10. Best Practices
1. **Communicate lock ownership:** Post in your team chat when acquiring the draft lock for major edits.
2. **Name snapshots:** Descriptive labels help future editors understand what changed.
3. **Verify links:** The admin normalizes URLs, but it cannot guarantee the destination works. Always test external links.
4. **Purge unused media:** Keep storage tidy by deleting outdated uploads.
5. **Audit regularly:** Review the Audit Log after large updates to confirm who published and when.

## 11. Troubleshooting
- **Cannot edit fields:** Ensure you are in Draft view and hold the draft lock. If another editor is active, coordinate a handoff.
- **Draft changes missing:** Confirm you clicked **Save Draft** before navigating away. Restore a recent snapshot if needed.
- **Allowlist updates failing:** Check the error banner for API details. Retry after a few seconds; persistent issues may indicate server-side configuration problems.
- **Upload errors:** Large files or unsupported formats may fail. Check console logs or try again after refreshing.
- **Preview mismatch:** Verify the preview tab is loading with `?stage=draft`. Clear browser cache if the live site appears instead.

## 12. Quick Reference Checklist
- Acquire draft lock → Switch to Draft → Make edits → Save Draft → Snapshot (optional) → Preview → Publish to Live → Release lock.
- Update allowlist whenever new admins join or depart.
- Periodically clean the media library and review the audit trail.

