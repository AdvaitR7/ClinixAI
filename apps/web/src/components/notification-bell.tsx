"use client";

import Link from "next/link";
import type { NotificationView } from "@clinix/schemas";
import { useApiData } from "@/lib/api";
import { unreadCount } from "@/lib/notifications";

/**
 * Header bell that links to the notifications screen and shows the unread count as text.
 * A failed or pending fetch shows no count rather than blocking the header.
 */
export function NotificationBell({ doctor, appearance = "clear" }: { doctor: boolean; appearance?: "legacy" | "clear" }) {
  const state = useApiData<NotificationView[]>("/notifications");
  // Tolerate any non-list payload so a bad response can never break the header.
  const unread = state.status === "ready" && Array.isArray(state.data) ? unreadCount(state.data) : 0;
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className={`relative grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evidence ${
        appearance === "clear"
          ? "clear-glass text-clear-action"
          : `border ${doctor ? "border-copper text-copper" : "border-sage bg-surface text-botanical"}`
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" />
        <path d="M10 21h4" />
      </svg>
      {unread > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-critical px-1 font-sans text-xs font-bold leading-5 text-surface">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
