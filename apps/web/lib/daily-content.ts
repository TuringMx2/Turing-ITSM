export type DailyContentCategory = "technology" | "science";

type DailyFact = {
  kind: "fact";
  category: DailyContentCategory;
  title: string;
  body: string;
  source: string;
};

type DailyNewsItem = {
  kind: "news";
  category: DailyContentCategory;
  title: string;
  source: string;
  url: string;
};

export type DailyContentItem = DailyFact | DailyNewsItem;

const CURATED_FACTS: readonly DailyFact[] = [
  {
    kind: "fact",
    category: "technology",
    title: "La primera webcam vigilaba una cafetera",
    body: "En 1991, investigadores de Cambridge la usaron para saber si quedaba café sin levantarse de su escritorio.",
    source: "Curaduría interna",
  },
  {
    kind: "fact",
    category: "science",
    title: "El GPS necesita la relatividad para funcionar",
    body: "Los satélites corrigen diferencias entre el paso del tiempo en órbita y en la superficie terrestre; sin ese ajuste, la ubicación perdería precisión rápidamente.",
    source: "Curaduría interna",
  },
  {
    kind: "fact",
    category: "technology",
    title: "La Web nació como una propuesta para compartir información",
    body: "Tim Berners-Lee presentó la idea de la World Wide Web en 1989 para facilitar el intercambio de documentos entre investigadores.",
    source: "Curaduría interna",
  },
  {
    kind: "fact",
    category: "science",
    title: "La luz del Sol tarda unos ocho minutos en llegar",
    body: "La distancia entre el Sol y la Tierra hace que la luz que vemos sea una imagen del Sol de hace aproximadamente ocho minutos y veinte segundos.",
    source: "Curaduría interna",
  },
  {
    kind: "fact",
    category: "technology",
    title: "Un código QR puede seguir funcionando aunque esté parcialmente dañado",
    body: "Su diseño incluye redundancia: esa información adicional permite reconstruir parte del código cuando una zona no se puede leer.",
    source: "Curaduría interna",
  },
  {
    kind: "fact",
    category: "science",
    title: "Un byte está formado por ocho bits",
    body: "Esta unidad permite representar 256 combinaciones distintas, desde 0 hasta 255, y es una de las bases de la información digital.",
    source: "Curaduría interna",
  },
];

const UNSUITABLE_CONTENT_TERMS = [
  "livestock",
  "ganado",
  "ganados",
  "ganaderia",
  "ganadero",
  "ganadera",
  "ganaderos",
  "ganaderas",
  "cattle",
  "cow",
  "cows",
  "vaca",
  "vacas",
  "beef",
  "dairy",
  "farm",
  "farms",
  "granja",
  "farming",
  "agriculture",
  "agricultural",
  "agricultura",
  "agricola",
  "agricolas",
  "agronomy",
  "agronomic",
  "agronomia",
  "agronomico",
  "agronomica",
  "poultry",
  "sheep",
  "oveja",
  "ovejas",
  "goat",
  "goats",
  "cabra",
  "cabras",
  "pig",
  "pigs",
  "swine",
  "cerdo",
  "cerdos",
  "horse",
  "horses",
  "equine",
  "caballo",
  "caballos",
  "veterinary",
  "veterinarian",
  "veterinaria",
  "veterinario",
  "animal",
  "animals",
  "animales",
  "wildlife",
  "fauna",
  "zoo",
  "zoology",
  "zoologia",
  "fish",
  "fishing",
  "fishery",
  "fisheries",
  "pesca",
  "pescado",
  "fisher",
  "aquaculture",
  "acuicultura",
];

const TECHNOLOGY_TERMS = [
  "tech",
  "technology",
  "software",
  "hardware",
  "computer",
  "computing",
  "internet",
  "web",
  "open source",
  "programming",
  "developer",
  "database",
  "cybersecurity",
  "security",
  "chip",
  "semiconductor",
  "artificial intelligence",
  "machine learning",
  "robotics",
  "quantum",
];

const SCIENCE_TERMS = [
  "science",
  "research",
  "physics",
  "quantum",
  "astronomy",
  "astronom",
  "space",
  "nasa",
  "climate",
  "biology",
  "chemistry",
];

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function includesAnyTerm(value: string, terms: readonly string[]): boolean {
  const normalized = normalizeText(value);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function includesAnyBoundedTerm(value: string, terms: readonly string[]): boolean {
  const normalized = normalizeText(value);
  return terms.some((term) => {
    const escapedTerm = normalizeText(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escapedTerm}(?=$|[^a-z0-9])`).test(normalized);
  });
}

function categoryForText(value: string): DailyContentCategory | null {
  if (includesAnyTerm(value, TECHNOLOGY_TERMS)) return "technology";
  if (includesAnyTerm(value, SCIENCE_TERMS)) return "science";
  return null;
}

export function getDailyFallback(dateKey: string): DailyFact {
  const index = Array.from(dateKey).reduce((total, character) => total + character.charCodeAt(0), 0) % CURATED_FACTS.length;
  return CURATED_FACTS[index];
}

export function createValidatedNewsItem(candidate: {
  title: unknown;
  source: unknown;
  url: unknown;
}): DailyNewsItem | null {
  if (typeof candidate.title !== "string" || typeof candidate.source !== "string" || typeof candidate.url !== "string") {
    return null;
  }

  const title = candidate.title.trim();
  const source = candidate.source.trim();
  const url = candidate.url.trim();
  if (title.length < 8 || title.length > 180 || source.length === 0 || url.length === 0) return null;
  if (includesAnyBoundedTerm(`${title} ${source} ${url}`, UNSUITABLE_CONTENT_TERMS)) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (!(["http:", "https:"] as string[]).includes(parsedUrl.protocol) || !parsedUrl.hostname) return null;

  const category = categoryForText(title);
  if (!category) return null;

  return { kind: "news", category, title, source, url: parsedUrl.toString() };
}

export function isDailyContentItem(value: unknown): value is DailyContentItem {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  if (
    (candidate.kind !== "fact" && candidate.kind !== "news") ||
    (candidate.category !== "technology" && candidate.category !== "science") ||
    typeof candidate.title !== "string" ||
    typeof candidate.source !== "string" ||
    candidate.title.trim().length === 0 ||
    candidate.source.trim().length === 0 ||
    includesAnyBoundedTerm(`${candidate.title} ${candidate.source}`, UNSUITABLE_CONTENT_TERMS)
  ) {
    return false;
  }

  if (candidate.kind === "fact") {
    return (
      typeof candidate.body === "string" &&
      candidate.body.trim().length > 0 &&
      !includesAnyBoundedTerm(candidate.body, UNSUITABLE_CONTENT_TERMS)
    );
  }

  const validatedNewsItem = createValidatedNewsItem({
    title: candidate.title,
    source: candidate.source,
    url: candidate.url,
  });
  return validatedNewsItem !== null && validatedNewsItem.category === candidate.category;
}
