import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </section>
  );
}
