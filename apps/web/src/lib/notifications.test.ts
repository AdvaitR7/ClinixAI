import { describe, expect, it } from "vitest";
import { notificationHref, unreadCount } from "./notifications";

describe("notification helpers", () => {
  it("maps known resource types to a route and leaves others non-navigable", () => {
    expect(notificationHref({ related_resource_type: "practice_member" })).toBe("/app/doctor/team");
    expect(notificationHref({ related_resource_type: "unknown_thing" })).toBeNull();
    expect(notificationHref({ related_resource_type: null })).toBeNull();
  });

  it("counts only unread items", () => {
    expect(unreadCount([{ read: false }, { read: true }, { read: false }])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});
