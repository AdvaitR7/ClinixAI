"use client";

import { useEffect } from "react";
import { registerNativeBackButton } from "@/lib/native";

/**
 * Mounted once in the root layout. Inside the Android shell it connects the hardware back button to
 * browser history; in a normal browser it renders nothing and does nothing.
 */
export function NativeShell() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void registerNativeBackButton().then((remove) => {
      if (cancelled) remove();
      else cleanup = remove;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
