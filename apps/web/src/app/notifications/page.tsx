"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationView } from "@clinix/schemas";
import { AuthShell } from "@/components/auth-shell";
import { RoleDock } from "@/components/role-dock";
import { RequireSession } from "@/components/route-guards";
import { Skeleton } from "@/components/skeleton";
import { useApiData } from "@/lib/api";
import { notificationHref, unreadCount } from "@/lib/notifications";
import { useApiWrite } from "@/lib/staff";

/** Notifications screen shared by every signed-in role, like /settings. */
export default function NotificationsPage() {
  return <RequireSession><NotificationList /></RequireSession>;
}

/** Lists the caller's notifications with unread state, mark-read on open and mark-all-read. */
function NotificationList() {
  const router = useRouter();
  const state = useApiData<NotificationView[]>("/notifications");
  const write = useApiWrite();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = state.status === "ready" ? state.data : [];
  const unread = unreadCount(items);

  /** Opens one notification: marks it read, then follows its destination when it has one. */
  async function open(item: NotificationView) {
    setError(null);
    try {
      if (!item.read) await write(`/notifications/${item.id}/read`, "POST");
      const href = notificationHref(item);
      if (href) router.push(href);
      else await state.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this notification.");
    }
  }

  /** Marks everything read in one request. */
  async function readAll() {
    setBusy(true);
    setError(null);
    try {
      await write("/notifications/read-all", "POST");
      await state.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark notifications as read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow="Notifications" title="Updates" orientation={unread ? `${unread} unread` : "You are up to date."} dock={<RoleDock />}>
      <Link href="/after-sign-in" className="mb-4 inline-flex min-h-11 items-center font-sans text-xs font-semibold text-botanical">← Back to workspace</Link>
      {state.status === "loading" && (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-3xl" />
          <Skeleton className="h-20 rounded-3xl" />
        </div>
      )}
      {state.status === "error" && (
        <section className="clinix-card p-5">
          <p role="alert" className="font-sans text-sm text-critical">We could not load your notifications.</p>
          <button type="button" onClick={() => void state.refresh()} className="mt-4 min-h-11 font-sans text-xs font-semibold uppercase text-clear-info">Try again</button>
        </section>
      )}
      {state.status === "ready" && items.length === 0 && (
        <p className="clinix-card p-5 font-sans text-sm text-graphite">No notifications yet.</p>
      )}
      {items.length > 0 && (
        <>
          {unread > 0 && (
            <button type="button" disabled={busy} onClick={() => void readAll()} className="mb-3 min-h-11 rounded-full border border-sage px-4 font-sans text-xs font-semibold text-botanical disabled:opacity-60">
              Mark all as read
            </button>
          )}
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void open(item)}
                  className="clinix-card block min-h-11 w-full p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evidence"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className={`font-sans text-sm text-ink ${item.read ? "font-medium" : "font-bold"}`}>{item.title}</span>
                    <span className={`shrink-0 font-sans text-xs uppercase ${item.read ? "text-graphite" : "font-bold text-botanical"}`}>{item.read ? "Read" : "Unread"}</span>
                  </span>
                  <span className="mt-1 block font-sans text-xs leading-5 text-graphite">{item.body}</span>
                  <span className="mt-2 block font-sans tabular-nums text-xs text-graphite">{new Date(item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert" className="mt-3 font-sans text-sm font-medium text-critical">{error}</p>}
    </AuthShell>
  );
}
