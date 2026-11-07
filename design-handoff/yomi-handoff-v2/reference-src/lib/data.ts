import c1 from "@/assets/cover-1.jpg";
import c2 from "@/assets/cover-2.jpg";
import c3 from "@/assets/cover-3.jpg";
import c4 from "@/assets/cover-4.jpg";
import c5 from "@/assets/cover-5.jpg";
import c6 from "@/assets/cover-6.jpg";

// Sample content for the design prototype only.
export type Series = {
  id: string;
  title: string;
  cover: string;
  type: "Manga" | "Manhwa" | "Manhua";
  genres: string[];
  chapters: number;
  read?: number;
  progress?: number;
  sources: string[];
  newCh?: number;
  addedByMe?: boolean;
  status: "Ongoing" | "Completed";
  synopsis: string;
};

const covers = [c1, c2, c3, c4, c5, c6];

export const series: Series[] = [
  { id: "silver-oath", title: "The Silver Oath Knight", cover: c1, type: "Manga", genres: ["Fantasy", "Action"], chapters: 89, read: 63, progress: 24, sources: ["MangaFreak", "Mangapill", "Manganato"], newCh: 2, status: "Ongoing", synopsis: "Reborn inside the game she once mastered, a forgotten heavy knight swears an oath to protect the one city every player abandoned." },
  { id: "necromancer", title: "Necromancer of the Blue Hour", cover: c2, type: "Manhwa", genres: ["Dark Fantasy", "Action"], chapters: 142, read: 1, progress: 17, sources: ["Asura", "Manganato"], newCh: 1, status: "Ongoing", synopsis: "A disgraced heir learns that the dead answer only to him — and the city's oldest families want him buried first." },
  { id: "jade-sword", title: "The Jade Sword of Cloud Peak", cover: c3, type: "Manhua", genres: ["Wuxia", "Adventure"], chapters: 310, read: 1, sources: ["Mangapill"], status: "Ongoing", synopsis: "A sect outcast climbs the forbidden peak to retrieve a blade that has chosen no master in a thousand years." },
  { id: "petals", title: "Petals That Remember", cover: c4, type: "Manga", genres: ["Romance", "Slice of Life"], chapters: 48, read: 23, sources: ["MangaFreak", "MangaDex"], status: "Completed", addedByMe: true, synopsis: "Every spring, the same girl appears under the school's oldest cherry tree — and only he remembers her from last year." },
  { id: "gauntlet", title: "Ascension by the Golden Fist", cover: c5, type: "Manhwa", genres: ["Action", "Martial Arts"], chapters: 201, read: 7, sources: ["Asura", "Reaper"], newCh: 3, status: "Ongoing", synopsis: "A boy with no mana inherits a gauntlet forged from a fallen sun, and the tower floors start to burn." },
  { id: "empress", title: "The Crimson Empress Returns", cover: c6, type: "Manhwa", genres: ["Romance", "Revenge"], chapters: 96, read: 40, sources: ["Manganato", "MangaDex"], status: "Ongoing", addedByMe: true, synopsis: "Executed by the husband she crowned, the empress wakes ten years earlier — this time, she chooses the throne for herself." },
];

const extraTitles = [
  "Moonlit Bookshop Diaries", "Iron Wolves of the North", "My Rival Is the Demon Lord", "Ten Thousand Swords Sect",
  "After School Exorcists", "The Tower Below Seoul", "A Duke's Quiet Contract", "Starfall Academy",
  "Last Ronin of Edo", "The Alchemist's Apprentice", "Blood Moon Hunters", "Café at the End of Time",
  "Heavenly Demon Reborn", "Paper Dragon", "The Villainess Wants a Nap", "Steel Lotus", "Ghost Train 0", "Kingdom of Ash",
];

export const catalog: Series[] = [
  ...series,
  ...extraTitles.map((title, i) => ({
    id: `x-${i}`,
    title,
    cover: covers[(i + 2) % covers.length]!,
    type: (["Manga", "Manhwa", "Manhua"] as const)[i % 3]!,
    genres: [["Fantasy", "Action", "Romance", "Comedy", "Drama", "Horror"][i % 6]!],
    chapters: 20 + ((i * 37) % 300),
    sources: ["Mangapill"],
    status: "Ongoing" as const,
    synopsis: "",
  })),
];

export const getSeries = (id: string): Series => catalog.find((s) => s.id === id) ?? series[0]!;

export type Site = { name: string; url: string; titles: number; status: "healthy" | "slow" | "down"; latency: number; lastSync: string; letter: string };
export const sites: Site[] = [
  { name: "MangaFreak", url: "mangafreak.me", titles: 48210, status: "healthy", latency: 180, lastSync: "4 min ago", letter: "MF" },
  { name: "Mangapill", url: "mangapill.com", titles: 39880, status: "healthy", latency: 240, lastSync: "6 min ago", letter: "MP" },
  { name: "Manganato", url: "manganato.com", titles: 61340, status: "slow", latency: 1420, lastSync: "22 min ago", letter: "MN" },
  { name: "MangaDex", url: "mangadex.org", titles: 72015, status: "healthy", latency: 310, lastSync: "3 min ago", letter: "MD" },
  { name: "Asura", url: "asuracomic.net", titles: 980, status: "healthy", latency: 210, lastSync: "8 min ago", letter: "AS" },
  { name: "Reaper", url: "reaperscans.com", titles: 1140, status: "down", latency: 0, lastSync: "3 h ago", letter: "RS" },
  { name: "Comick", url: "comick.io", titles: 55600, status: "healthy", latency: 290, lastSync: "5 min ago", letter: "CK" },
  { name: "Bato", url: "bato.to", titles: 58995, status: "slow", latency: 980, lastSync: "15 min ago", letter: "BT" },
];

export type Download = { id: string; seriesId: string; chapter: number; pages: number; size: string; state: "done" | "downloading" | "queued" | "failed"; pct: number };
export const downloads: Download[] = [
  { id: "d1", seriesId: "silver-oath", chapter: 64, pages: 42, size: "18.4 MB", state: "downloading", pct: 62 },
  { id: "d2", seriesId: "silver-oath", chapter: 65, pages: 38, size: "—", state: "queued", pct: 0 },
  { id: "d3", seriesId: "gauntlet", chapter: 8, pages: 71, size: "—", state: "queued", pct: 0 },
  { id: "d4", seriesId: "empress", chapter: 40, pages: 64, size: "26.1 MB", state: "done", pct: 100 },
  { id: "d5", seriesId: "empress", chapter: 39, pages: 60, size: "24.8 MB", state: "done", pct: 100 },
  { id: "d6", seriesId: "necromancer", chapter: 2, pages: 55, size: "—", state: "failed", pct: 31 },
  { id: "d7", seriesId: "petals", chapter: 23, pages: 34, size: "12.0 MB", state: "done", pct: 100 },
];
