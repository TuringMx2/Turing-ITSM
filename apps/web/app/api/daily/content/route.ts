import { NextResponse } from "next/server";
import { createValidatedNewsItem, getDailyFallback } from "@/lib/daily-content";

const NEWS_TIMEOUT_MS = 1_800;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readHits(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.hits)) return [];
  return payload.hits;
}

function newsItemFromHit(hit: unknown) {
  if (!isRecord(hit)) return null;

  const title = readString(hit.title) ?? readString(hit.story_title);
  const url = readString(hit.url) ?? readString(hit.story_url);
  if (!title || !url) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  return createValidatedNewsItem({
    title,
    source: `Hacker News · ${hostname}`,
    url,
  });
}

export async function GET(request: Request) {
  const dateKey = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const fallback = getDailyFallback(dateKey);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);

  try {
    const endpoint = new URL("https://hn.algolia.com/api/v1/search_by_date");
    endpoint.searchParams.set("tags", "story");
    endpoint.searchParams.set("hitsPerPage", "40");
    endpoint.searchParams.set("query", "technology");

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`News source returned ${response.status}`);

    for (const hit of readHits(await response.json())) {
      const item = newsItemFromHit(hit);
      if (item) {
        return NextResponse.json({ fallback: false, item }, { headers: { "Cache-Control": "no-store" } });
      }
    }
  } catch {
    // External news is optional; the local fact is always a valid response.
  } finally {
    clearTimeout(timeoutId);
  }

  return NextResponse.json({ fallback: true, item: fallback }, { headers: { "Cache-Control": "no-store" } });
}
