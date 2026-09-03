"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedDateParts(date: Date, timezoneName: string): ZonedDateParts | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezoneName,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    const values = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    const [year, month, day, hour, minute, second] = values;
    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function localTimestamp(
  parts: ZonedDateParts,
  hour = parts.hour,
  dayOffset = 0,
  minute = parts.minute,
  second = parts.second,
): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour, minute, second, 0);
}

function timezoneOffset(date: Date, timezoneName: string): number | null {
  const parts = zonedDateParts(date, timezoneName);
  return parts ? localTimestamp(parts) - date.getTime() : null;
}

function nextBoundaryDelay(now: Date, timezoneName: string): number | null {
  const current = zonedDateParts(now, timezoneName);
  if (!current) return null;

  const targetLocalTimestamp = current.hour < 16
    ? localTimestamp(current, 16, 0, 0, 0)
    : localTimestamp(current, 0, 1, 0, 0);
  const currentOffset = timezoneOffset(now, timezoneName);
  if (currentOffset === null) return null;

  let targetTimestamp = targetLocalTimestamp - currentOffset;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const targetOffset = timezoneOffset(new Date(targetTimestamp), timezoneName);
    if (targetOffset === null) return null;
    const adjustedTimestamp = targetLocalTimestamp - targetOffset;
    if (adjustedTimestamp === targetTimestamp) break;
    targetTimestamp = adjustedTimestamp;
  }

  const delay = targetTimestamp - now.getTime();
  return Number.isFinite(delay) && delay > 0 ? delay : 1_000;
}

export function DailyPhaseRefresh({ timezoneName }: { timezoneName?: string }) {
  const router = useRouter();
  const lastFallbackRefresh = useRef(0);

  useEffect(() => {
    if (!timezoneName?.trim() || !zonedDateParts(new Date(), timezoneName)) return;

    let disposed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (disposed) return;
      const delay = nextBoundaryDelay(new Date(), timezoneName);
      if (delay === null) return;
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        if (disposed) return;
        router.refresh();
        schedule();
      }, delay);
    };

    const refreshOnReturn = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastFallbackRefresh.current < 30_000) return;
      lastFallbackRefresh.current = now;
      router.refresh();
    };

    schedule();
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      disposed = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [router, timezoneName]);

  return null;
}
