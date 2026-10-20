/** studio/bible.json: the look of the video, its characters (one sheet each) and its places. */
export interface Character {
  id: string;
  name: string;
  description: string;
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
