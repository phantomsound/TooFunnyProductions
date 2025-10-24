// backend/auth.js (ESM)
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logAdminAction } from "./lib/audit.js";
import { getAllowlist } from "./lib/allowlist.js";

const DEV_FALLBACK_FRONTEND = "http://localhost:5173";

function getDevBackendFallback() {
  return `http://localhost:${process.env.PORT || 5000}`;
}

function pickFirstConfiguredFrontend() {
  const envCandidates = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGIN || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeFrontendBase(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function normalizeFrontendBase(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    const pathname = url.pathname === "/" ? "" : url.pathname;
    return `${url.origin}${pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeAbsoluteUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function resolveFrontendUrl(req) {
  const configured = pickFirstConfiguredFrontend();
  if (configured) return configured;

  const originHeader = normalizeFrontendBase(req?.headers?.origin);
  if (originHeader) return originHeader;

  const forwardedProto = req?.headers?.["x-forwarded-proto"]?.split(",")?.[0];
  const forwardedHost = req?.headers?.["x-forwarded-host"];
  const host = forwardedHost || req?.get?.("host");
  const protocol = forwardedProto || req?.protocol;

  if (protocol && host) {
    const combined = normalizeFrontendBase(`${protocol}://${host}`);
    if (combined) {
      try {
        const url = new URL(combined);
        const serverPort = Number(process.env.PORT || 5000);
        const isLoopback = ["localhost", "127.0.0.1"].includes(url.hostname);
        if (isLoopback && (!url.port || Number(url.port) === serverPort)) {
          return DEV_FALLBACK_FRONTEND;
        }
      } catch {
        // ignore and fall through to combined
      }
      return combined;
    }
  }

  return DEV_FALLBACK_FRONTEND;
}

function resolveBackendBase(req) {
  const envCandidates = [
    process.env.BACKEND_URL,
    process.env.PUBLIC_BACKEND_URL,
    process.env.API_PUBLIC_URL,
    process.env.API_URL,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeFrontendBase(candidate);
    if (normalized) return normalized;
  }

  const forwardedProto = req?.headers?.["x-forwarded-proto"]?.split(",")?.[0];
  const forwardedHost = req?.headers?.["x-forwarded-host"]?.split(",")?.[0];
  const host = forwardedHost || req?.get?.("host");
  const protocol = forwardedProto || req?.protocol;

  if (protocol && host) {
    const combined = normalizeFrontendBase(`${protocol}://${host}`);
    if (combined) return combined;
  }

  return getDevBackendFallback();
}

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.trim().toLowerCase();
  return ["localhost", "127.0.0.1", "::1"].includes(lower);
}

function isLoopbackRequest(req) {
  const forwardedHost = req?.headers?.["x-forwarded-host"]?.split(",")?.[0];
  const hostHeader = forwardedHost || req?.get?.("host") || "";
  const hostname = hostHeader.split(":")?.[0];
  return isLoopbackHost(hostname);
}

function resolveGoogleCallback(req) {
  const raw = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (raw) {
    if (raw.startsWith("/")) {
      return `${resolveBackendBase(req)}${raw}`;
    }
    const normalized = normalizeAbsoluteUrl(raw);
    if (normalized) {
      try {
        const url = new URL(normalized);
        if (isLoopbackHost(url.hostname) && !isLoopbackRequest(req)) {
          console.warn(
            "⚠️ Ignoring GOOGLE_CALLBACK_URL pointing at localhost/loopback while serving a non-local request. Falling back to auto-detected host.",
            normalized
          );
        } else {
          return normalized;
        }
      } catch {
        return normalized;
      }
    }
    console.warn(
      "⚠️ Ignoring invalid GOOGLE_CALLBACK_URL value. Falling back to auto-detected host.",
      raw
    );
  }

  return `${resolveBackendBase(req)}/api/auth/google/callback`;
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export function initAuth(app) {
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  const requiredGoogleEnv = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ];
  const missingGoogleEnv = requiredGoogleEnv.filter((key) => !process.env[key]);
  const hasGoogleStrategy = missingGoogleEnv.length === 0;

  if (!hasGoogleStrategy) {
    console.error(
      "❌ Google OAuth disabled: missing environment variables ->",
      missingGoogleEnv.join(", ") || "unknown"
    );
    console.error(
      "   Update backend/.env (see backend/.env.example) and restart the service to re-enable admin login."
    );
  } else {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = (profile.emails?.[0]?.value || "").toLowerCase();
            const user = {
              email,
              name: profile.displayName,
              picture: profile.photos?.[0]?.value || null,
            };
            return done(null, user);
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  }

  app.use(passport.initialize());
  app.use(passport.session());

  if (hasGoogleStrategy) {
    // Begin OAuth
    app.get("/api/auth/google", (req, res, next) => {
      passport.authenticate("google", {
        scope: ["profile", "email"],
        callbackURL: resolveGoogleCallback(req),
      })(req, res, next);
    });

    // OAuth callback → redirect to SPA
    app.get("/api/auth/google/callback", (req, res, next) => {
      const frontendUrl = resolveFrontendUrl(req);

      passport.authenticate(
        "google",
        { callbackURL: resolveGoogleCallback(req) },
        (err, user) => {
          if (err || !user) {
            if (err) {
              console.error("Google OAuth error", err);
            }
            return res.redirect(`${frontendUrl}/admin?auth=failed`);
          }

          req.logIn(user, async (loginErr) => {
            if (loginErr) {
              console.error("Google OAuth session error", loginErr);
              return res.redirect(`${frontendUrl}/admin?auth=failed`);
            }

            const email = (req.user?.email || user.email || "").toLowerCase();
            const allowed = getAllowlist().includes(email);
            try {
              await logAdminAction(email || "unknown", allowed ? "login" : "login_denied");
            } catch {}
            if (!allowed) return res.redirect(`${frontendUrl}/admin?auth=denied`);
            res.redirect(`${frontendUrl}/admin`);
          });
        }
      )(req, res, next);
    });
  } else {
    const missingPayload = {
      error: "Google OAuth is not configured",
      missingEnv: missingGoogleEnv,
    };
    app.get("/api/auth/google", (_req, res) => res.status(503).json(missingPayload));
    app.get("/api/auth/google/callback", (_req, res) => {
      res.status(503).json(missingPayload);
    });
  }

  // Who am I?
  app.get("/api/auth/me", (req, res) => {
    const email = (req.user?.email || "").toLowerCase();
    const isAdmin = getAllowlist().includes(email);
    if (!req.user) {
      return res.json({
        user: null,
        isAdmin: false,
        ...(hasGoogleStrategy ? {} : { missingEnv: missingGoogleEnv }),
      });
    }
    res.json({
      user: { email: req.user.email, name: req.user.name, picture: req.user.picture },
      isAdmin,
    });
  });

  // Logout
  app.post("/api/auth/logout", async (req, res) => {
    const email = req.user?.email || "unknown";
    try {
      await logAdminAction(email, "logout");
    } catch {}
    req.logout(() => {
      req.session?.destroy(() => res.sendStatus(204));
    });
  });
}

// Admin gates
export function requireAdmin(req, res, next) {
  const email = (req.user?.email || "").toLowerCase();
  const allowed = getAllowlist().includes(email);
  if (!req.user || !allowed) return res.sendStatus(403);
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.sendStatus(401);
  next();
}
