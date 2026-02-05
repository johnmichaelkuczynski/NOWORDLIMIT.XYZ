import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import pg from "pg";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      googleId?: string | null;
      email?: string | null;
      displayName?: string | null;
    }
  }
}

export function setupAuth(app: Express) {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.warn("Google OAuth credentials not found. Google login disabled.");
    return;
  }

  // Trust proxy for production (behind Render/nginx)
  app.set('trust proxy', 1);

  // Database-backed session store
  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  pool.on('error', (err) => {
    console.error('Session pool error:', err);
  });
  
  pool.on('connect', () => {
    console.log('Session pool connected to database');
  });

  // Session setup with database storage
  const pgStore = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    errorLog: console.error.bind(console, 'Session store error:'),
  });

  const isProduction = process.env.NODE_ENV === 'production';
  
  app.use(
    session({
      store: pgStore,
      secret: process.env.SESSION_SECRET || "text-intelligence-studio-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction || !!process.env.REPLIT_DEV_DOMAIN,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );
  
  console.log(`Session configured. Secure cookies: ${isProduction || !!process.env.REPLIT_DEV_DOMAIN}`);

  app.use(passport.initialize());
  app.use(passport.session());

  // Get the callback URL - for production use the custom domain
  const getCallbackURL = () => {
    // Production custom domain
    if (process.env.NODE_ENV === "production") {
      return "https://textsurgeon.com/auth/google/callback";
    }
    if (process.env.REPLIT_DEV_DOMAIN) {
      return `https://${process.env.REPLIT_DEV_DOMAIN}/auth/google/callback`;
    }
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/auth/google/callback`;
    }
    return "http://localhost:5000/auth/google/callback";
  };

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: getCallbackURL(),
        passReqToCallback: false,
      } as any,
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const displayName = profile.displayName || null;
          const googleId = profile.id;
          
          console.log(`Google OAuth: Processing login for ${email || googleId}`);

          // Find or create user
          let user = await storage.getUserByGoogleId(googleId);
          
          if (!user) {
            // Try to find by email
            if (email) {
              user = await storage.getUserByEmail(email);
            }
            
            if (!user) {
              // Create new user
              const username = email?.split("@")[0] || `user_${googleId.substring(0, 8)}`;
              user = await storage.createUserWithGoogle({
                username,
                googleId,
                email,
                displayName,
              });
              console.log(`Google OAuth: Created new user ${user.id} (${user.username})`);
            } else {
              // Update existing user with Google info
              user = await storage.updateUserGoogle(user.id, {
                googleId,
                displayName,
              });
              console.log(`Google OAuth: Updated existing user ${user.id} with Google info`);
            }
          } else {
            // Update profile info
            user = await storage.updateUserGoogle(user.id, {
              displayName,
            });
            console.log(`Google OAuth: Updated profile for user ${user.id}`);
          }

          console.log(`Google OAuth: Login successful for user ${user.id}`);
          done(null, user);
        } catch (error) {
          console.error("Google auth error:", error);
          done(error as Error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUserById(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Auth routes
  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?error=auth_failed" }),
    (req, res) => {
      req.session.save(() => {
        res.redirect("/");
      });
    }
  );

  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          displayName: req.user.displayName,
        },
      });
    } else {
      res.json({ authenticated: false, user: null });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  console.log("Google OAuth configured. Callback URL:", getCallbackURL());
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
};
