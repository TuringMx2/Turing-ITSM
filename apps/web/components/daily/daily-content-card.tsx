"use client";

import { useEffect, useState } from "react";
import { getDailyFallback, isDailyContentItem, type DailyContentItem } from "@/lib/daily-content";

type DailyContentCardProps = {
  dateKey: string;
  isCurrentDate: boolean;
};

const categoryLabels = {
  technology: "Tecnología",
  science: "Ciencia",
} as const;

function readNewsItem(payload: unknown): DailyContentItem | null {
  if (typeof payload !== "object" || payload === null) return null;
  const item = (payload as Record<string, unknown>).item;
  return isDailyContentItem(item) && item.kind === "news" ? item : null;
}

export function DailyContentCard({ dateKey, isCurrentDate }: DailyContentCardProps) {
  const [content, setContent] = useState<DailyContentItem>(() => getDailyFallback(dateKey));

  useEffect(() => {
    if (!isCurrentDate) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2_500);

    async function loadNews() {
      try {
        const response = await fetch(`/api/daily/content?date=${encodeURIComponent(dateKey)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;

        const newsItem = readNewsItem(await response.json());
        if (newsItem) setContent(newsItem);
      } catch {
        // The curated fact remains visible when the optional news request fails.
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadNews();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [dateKey, isCurrentDate]);

  const isNews = content.kind === "news";

  return (
    <article aria-labelledby="daily-content-heading" className="daily-content-card" aria-live="polite">
      <div aria-hidden="true" className="daily-content-card-mark">?</div>
      <div className="daily-content-card-copy">
        <div className="daily-content-card-header">
          <p className="eyebrow">{categoryLabels[content.category]}</p>
          <span className="daily-content-card-type">{isNews ? "Novedad reciente" : "Curiosidad"}</span>
        </div>
        <h2 id="daily-content-heading">¿Sabías que?</h2>
        {isNews ? (
          <a className="daily-content-card-title" href={content.url} rel="noreferrer" target="_blank">
            {content.title}
          </a>
        ) : (
          <h3 className="daily-content-card-title">{content.title}</h3>
        )}
        {!isNews ? <p className="daily-content-card-body">{content.body}</p> : null}
        <p className="daily-content-card-source">
          <span>Fuente:</span> {content.source}
        </p>
      </div>
    </article>
  );
}
