import type { Backend } from "../core/types";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Charge le backend adapté : appels natifs sous Tauri, serveur proxy sur le web. */
export async function loadBackend(): Promise<Backend> {
  if (isDesktop) {
    const { createDesktopBackend } = await import("./desktop");
    return createDesktopBackend();
  }
  const { createWebBackend } = await import("./web");
  return createWebBackend();
}
