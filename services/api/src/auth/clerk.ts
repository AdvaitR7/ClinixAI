import { createClerkClient, verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { profiles } from "../schema.js";
import type { UserRole } from "@clinix/schemas";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

/** Verify a Clerk session token (or dev-session JWT) → clerk user id. */
export async function verifySession(token: string): Promise<string> {
  const claims = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  return claims.sub;
}

/**
 * Lazy profile sync (master plan Phase 1): create the profiles row on first
 * onboarding call. Roles only ever originate here — never from client claims.
 */
export async function ensureProfile(clerkUserId: string, role: UserRole) {
  const database = requireDb();
  const existing = await database
    .select()
    .from(profiles)
    .where(eq(profiles.clerkUserId, clerkUserId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  let displayName = "";
  try {
    const user = await clerk.users.getUser(clerkUserId);
    displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.primaryEmailAddress?.emailAddress ||
      user.primaryPhoneNumber?.phoneNumber ||
      "";
  } catch {
    // Clerk lookup is best-effort; profile still gets created.
  }

  const inserted = await database
    .insert(profiles)
    .values({ clerkUserId, primaryRole: role, displayName })
    .returning();
  return inserted[0];
}
