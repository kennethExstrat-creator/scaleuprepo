"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { IDLE_WARNING_BEFORE_MS, type UnauthenticatedReason } from "@/lib/auth/idle";
import { SESSION_IDLE_TIMEOUT_MS } from "@/lib/constants";

/** Shared across tabs: when this browser last reset the server's idle clock (epoch ms). */
const STORAGE_KEY = "su:idle-last-touch";
const WARNING_TOAST_ID = "idle-timeout-warning";
const CHECK_INTERVAL_MS = 10_000;
/** Activity is processed at most this often (pointermove fires many times a second). */
const ACTIVITY_THROTTLE_MS = 1_000;
/**
 * While the user is active, ping /auth/keepalive once the server clock is this old, so the
 * server's `su_last_seen` never trails real activity by more than about a minute.
 */
const KEEPALIVE_INTERVAL_MS = 60_000;
/** Minimum gap between ping attempts (e.g. while offline). */
const PING_RETRY_MS = 15_000;
/**
 * Until the mount-time ping answers, assume the server clock was reset this long before mount
 * (the page request was stamped before the page finished loading).
 */
const MOUNT_SKEW_MS = 10_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;

/**
 * Client half of the 30-minute idle timeout (BRD B11; the proxy enforces it on the server).
 *
 * Activity = pointer, keyboard, touch, scroll, or the tab becoming visible again; while the
 * user is active it pings /auth/keepalive at most once a minute, which refreshes the
 * server's `su_last_seen` cookie. The countdown is anchored to the last successful reset of
 * that server clock (a ping sent on mount, later pings, or pings in other tabs), so the warning
 * always comes 2 minutes before the server would end the session. After 28 minutes a toast
 * offers "Stay signed in" (pings /auth/keepalive); at 30 minutes it POSTs
 * /auth/signout?reason=timeout and loads /login?reason=timeout. A 503 from the keep-alive
 * (Supabase Auth unavailable) is ignored and retried later. Mount once per authenticated layout
 * or session-only page (/mfa, /terms, /set-password, /no-access); renders nothing.
 */
export function IdleTimer() {
  useEffect(() => {
    // The request that rendered this page reset the server clock shortly before mount, but
    // "shortly" includes the page-load time. Start from a conservative estimate; the ping sent
    // below anchors the countdown exactly (the server stamps the ping after we send it).
    let lastTouch = Date.now() - MOUNT_SKEW_MS;
    let lastPingAttempt = 0;
    let lastActivityHandled = 0;
    let pinging = false;
    let warningShown = false;
    let finished = false;

    const readShared = (): number => {
      try {
        const value = Number(window.localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(value) ? value : 0;
      } catch {
        return 0;
      }
    };
    const writeShared = (time: number) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(time));
      } catch {
        // Storage unavailable (private mode): this tab still tracks its own pings.
      }
    };
    const touch = (time: number) => {
      lastTouch = Math.max(lastTouch, time);
      // Never move the shared clock backwards (another tab may have pinged more recently).
      if (readShared() < lastTouch) writeShared(lastTouch);
    };
    const serverIdleFor = (now: number) => now - Math.max(lastTouch, readShared());

    const hideWarning = () => {
      if (!warningShown) return;
      warningShown = false;
      toast.dismiss(WARNING_TOAST_ID);
    };

    /** Full page load on purpose: it discards the client router cache (confidential data). */
    const leave = (reason: UnauthenticatedReason) => {
      finished = true;
      toast.dismiss(WARNING_TOAST_ID);
      window.location.assign(reason === "timeout" ? "/login?reason=timeout" : "/login");
    };

    const signOut = async () => {
      if (finished) return;
      finished = true;
      toast.dismiss(WARNING_TOAST_ID);
      try {
        await fetch("/auth/signout?reason=timeout", {
          method: "POST",
          redirect: "manual",
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        // Offline: the server-side timeout still ends the session on the next request.
      }
      leave("timeout");
    };

    const showWarning = () => {
      if (warningShown) return;
      warningShown = true;
      toast.warning("You'll be signed out soon", {
        id: WARNING_TOAST_ID,
        description: "For security, you'll be signed out after 30 minutes of inactivity.",
        duration: Infinity,
        action: {
          label: "Stay signed in",
          onClick: () => {
            warningShown = false;
            void keepAlive();
          },
        },
        onDismiss: () => {
          warningShown = false;
        },
      });
    };

    const check = () => {
      if (finished) return;
      const idle = serverIdleFor(Date.now());
      if (idle >= SESSION_IDLE_TIMEOUT_MS) void signOut();
      else if (idle >= SESSION_IDLE_TIMEOUT_MS - IDLE_WARNING_BEFORE_MS) showWarning();
      else hideWarning();
    };

    const keepAlive = async () => {
      if (pinging || finished) return;
      pinging = true;
      const sentAt = Date.now();
      lastPingAttempt = sentAt;
      try {
        const response = await fetch("/auth/keepalive", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) {
          // The server stamped su_last_seen when it received the ping, i.e. at or after sentAt.
          touch(sentAt);
          check();
        } else if (response.status === 401 && !finished) {
          const body = (await response.json().catch(() => null)) as { reason?: string } | null;
          leave(body?.reason === "timeout" ? "timeout" : "signed_out");
        }
      } catch {
        // Network hiccup: retried on the next activity after PING_RETRY_MS.
      } finally {
        pinging = false;
      }
    };

    const onActivity = () => {
      if (finished) return;
      const now = Date.now();
      if (now - lastActivityHandled < ACTIVITY_THROTTLE_MS) return;
      lastActivityHandled = now;
      const idle = serverIdleFor(now);
      // After sleep or a long time in the background, the first interaction must not revive
      // a session the server has already ended.
      if (idle >= SESSION_IDLE_TIMEOUT_MS) {
        void signOut();
        return;
      }
      if (idle >= KEEPALIVE_INTERVAL_MS && now - lastPingAttempt >= PING_RETRY_MS) void keepAlive();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") onActivity();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) check();
    };

    touch(lastTouch);

    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    const passive = { passive: true } as const;
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, passive);
    window.addEventListener("scroll", onActivity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onVisibilityChange);
    window.addEventListener("storage", onStorage);
    void keepAlive();

    return () => {
      finished = true; // ignore a ping that answers after unmount (e.g. after a client navigation)
      window.clearInterval(interval);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity);
      window.removeEventListener("scroll", onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      toast.dismiss(WARNING_TOAST_ID);
    };
  }, []);

  return null;
}
