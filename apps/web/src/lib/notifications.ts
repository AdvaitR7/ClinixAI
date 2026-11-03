import type { NotificationView } from "@clinix/schemas";

/** Routes a notification's related resource type can open; anything else stays non-navigable. */
const DESTINATIONS: Record<string, string> = {
  practice_member: "/app/doctor/team",
};

/** Returns the in-app route for a notification, or null when it has no destination. */
export function notificationHref(n: Pick<NotificationView, "related_resource_type">): string | null {
  return n.related_resource_type ? (DESTINATIONS[n.related_resource_type] ?? null) : null;
}

/** Counts notifications the recipient has not opened yet. */
export function unreadCount(items: Pick<NotificationView, "read">[]): number {
  return items.filter((n) => !n.read).length;
}
