import type { TaskEstimateUnit } from "@turing-itsm/types";

export type { TaskEstimateUnit } from "@turing-itsm/types";

const quantityFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 2,
});

export function formatTaskEstimate(
  quantity: number | null,
  unit: TaskEstimateUnit | null,
): string {
  if (
    quantity === null ||
    unit === null ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return "Sin estimación";
  }

  const formattedQuantity = quantityFormatter.format(quantity);
  if (unit === "hours") return `${formattedQuantity} h`;
  return `${formattedQuantity} ${quantity === 1 ? "día" : "días"}`;
}
