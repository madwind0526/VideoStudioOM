const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** A copy of a list in A-Z order of the text the user sees: numbers by value, Latin letters before Korean. Every choice list of the app uses it. */
export const ascending = <T,>(items: readonly T[], label: (item: T) => string): T[] => [...items].sort((a, b) => collator.compare(label(a), label(b)));
