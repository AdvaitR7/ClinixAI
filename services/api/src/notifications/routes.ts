import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { error, requireDb } from "../http.js";
import { notifications } from "../schema.js";

/** In-app notifications for the signed-in profile (DB spec §32.1). */
export async function notificationRoutes(app: FastifyInstance) {
  /** Latest notifications, newest first. */
  app.get("/notifications", async (request) => {
    const rows = await requireDb()
      .select()
      .from(notifications)
      .where(eq(notifications.recipientProfileId, request.auth.profileId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.readAt !== null,
      related_resource_type: n.relatedResourceType,
      related_resource_id: n.relatedResourceId,
      created_at: n.createdAt.toISOString(),
    }));
  });

  /** Marks every unread notification of the caller as read and reports how many changed. */
  app.post("/notifications/read-all", async (request) => {
    const rows = await requireDb()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientProfileId, request.auth.profileId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  });

  /** Marks one of the caller's own notifications as read. */
  app.post<{ Params: { id: string } }>("/notifications/:id/read", async (request, reply) => {
    const [row] = await requireDb()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, request.params.id), eq(notifications.recipientProfileId, request.auth.profileId)))
      .returning({ id: notifications.id });
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Notification not found");
    return { id: row.id, read: true };
  });
}
