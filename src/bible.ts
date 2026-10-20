/** studio/bible.json: the look of the video, its characters (one sheet each) and its places. */
export interface Outfit {
  /** The word that picks this outfit when it appears in a scene description. */
  name: string;
  description: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Pictures of the real or designed person (assets/images/...): extra references next to the character sheet. */
  photos?: string[];
  /** Other clothes for single scenes; the face and hair stay those of the sheet. */
  outfits?: Outfit[];
}

export interface Place {
  name: string;
  description: string;
}

export interface Bible {
  style: string;
  /** Direction preset id (shared/presets.mjs): one way of shooting and telling the whole video. */
  preset?: string;
  characters: Character[];
  places: Place[];
}

export const BIBLE_FILE = "studio/bible.json";
export const emptyBible = (): Bible => ({ style: "", characters: [], places: [] });

/** Each character has her or his own sheet at this path (a sheet shows one person from several sides). */
export const sheetPath = (character: Character) => `assets/images/sheet-${character.id}.png`;

const mentions = (text: string, name: string) => name.trim() !== "" && text.toLowerCase().includes(name.trim().toLowerCase());

/** Characters whose name appears in the text (a scene description, a prompt), in bible order. */
export const charactersIn = (bible: Bible | null | undefined, text: string): Character[] => (bible?.characters ?? []).filter((character) => mentions(text, character.name));

/**
 * Reference pictures for the people of a scene, at most `room` (H3 takes 9 in all): one character sheet each first,
 * then their own photos while there is room left.
 */
export function referencesFor(characters: Character[], images: { path: string }[], room: number): string[] {
  const has = (path: string) => images.some((image) => image.path === path);
  const sheets = characters.map(sheetPath).filter(has);
  const photos = characters.flatMap((character) => (character.photos ?? []).filter(has));
  return [...sheets, ...photos].slice(0, room);
}

/** What a reference picture shows, in English, for the prompt maker. */
export function describeReference(bible: Bible | null | undefined, path: string, images: { path: string; record?: Record<string, unknown> | null }[]): string {
  const sheetOf = bible?.characters.find((character) => sheetPath(character) === path);
  if (sheetOf) return `character sheet of ${sheetOf.name}: ${sheetOf.description}`;
  const photoOf = bible?.characters.find((character) => character.photos?.includes(path));
  if (photoOf) return `reference photo of ${photoOf.name}: ${photoOf.description}`;
  const recipe = images.find((image) => image.path === path)?.record;
  return typeof recipe?.prompt === "string" ? `scene picture: ${recipe.prompt.slice(0, 300)}` : "scene picture";
}
