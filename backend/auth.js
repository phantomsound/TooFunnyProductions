// backend/auth.js (ESM)
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { logAdminAction } from "./lib/audit.js";

function getAllowlist() {
  return (process.env.ALLOWLIST_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export function initAuth(app) {
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
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

  app.use(passport.initialize());
  app.use(passport.session());

  // Begin OAuth
  app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

  // OAuth callback → redirect to SPA
  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "http://localhost:5173/admin?auth=failed" }),
    async (req, res) => {
      const email = (req.user?.email || "").toLowerCase();
      const allowed = getAllowlist().includes(email);
      try {
        await logAdminAction(email || "unknown", allowed ? "login" : "login_denied");
      } catch {}
      if (!allowed) return res.redirect("http://localhost:5173/admin?auth=denied");
      res.redirect("http://localhost:5173/admin");
    }
  );

  // Who am I?
  app.get("/api/auth/me", (req, res) => {
    const email = (req.user?.email || "").toLowerCase();
    const isAdmin = getAllowlist().includes(email);
    if (!req.user) return res.json({ user: null, isAdmin: false });
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
