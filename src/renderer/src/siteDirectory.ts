/**
 * Sites that are known to work in Yomi, offered under "Add a site" so nobody has to hunt for addresses. Picking one
 * adds it exactly as pasting its address would. Found through HaruNeko's site list and tested here
 * (see docs/sources/haruneko-sites.md); a site goes on this list only once its titles, chapters and pages all load.
 */
export interface DirectorySite {
  name: string
  url: string
  lang: 'ar' | 'en'
}

export const SITE_DIRECTORY: DirectorySite[] = [
  { name: 'مانجا العاشق 3asq', url: 'https://3asq.online/', lang: 'ar' },
  { name: 'Fastest Manga', url: 'https://www.fastestmanga.com/', lang: 'ar' },

  { name: 'AquaManga', url: 'https://aquareader.org/', lang: 'en' },
  { name: 'Asura Scans', url: 'https://asurascans.com/', lang: 'en' },
  { name: 'Eva Scans', url: 'https://evascans.net/', lang: 'en' },
  { name: 'GD Scans', url: 'https://gdscans.com/', lang: 'en' },
  { name: 'Gourmet Scans', url: 'https://gourmetsupremacy.com/', lang: 'en' },
  { name: 'KingOfShojo', url: 'https://kingofshojo.com/', lang: 'en' },
  { name: 'Lagoon Scans', url: 'https://lagoonscans.com/', lang: 'en' },
  { name: 'Madara Scans', url: 'https://madarascans.net/', lang: 'en' },
  { name: 'Manga Eclipse', url: 'https://mangaeclipse.com/', lang: 'en' },
  { name: 'MangaOwl', url: 'https://mangaowl.io/', lang: 'en' },
  { name: 'MangaRead', url: 'https://www.mangaread.org/', lang: 'en' },
  { name: 'MangaReader.site', url: 'https://mangareader.site/', lang: 'en' },
  { name: 'Mangasushi', url: 'https://mangasushi.org/', lang: 'en' },
  { name: 'ManhwaNex', url: 'https://manhwanex.com/', lang: 'en' },
  { name: 'Rackus', url: 'https://rackusreads.com/', lang: 'en' },
  { name: 'Rizz Comics', url: 'https://rizzfables.com/', lang: 'en' },
  { name: 'Rokari Comics', url: 'https://rokaricomics.com/', lang: 'en' },
  { name: 'S2Manga', url: 'https://s2read.com/', lang: 'en' },
  { name: 'Scythe Scans', url: 'https://scythescans.com/', lang: 'en' },
  { name: 'Tarot Scans', url: 'https://www.tarotscans.com/', lang: 'en' },
  { name: 'ThunderScans', url: 'https://en-thunderscans.com/', lang: 'en' },
  { name: 'Top Manhua', url: 'https://topmanhua.net/', lang: 'en' },
  { name: 'Tritinia Scans', url: 'https://tritinia.org/', lang: 'en' },
  { name: 'Violet Scans', url: 'https://violetmanga.com/', lang: 'en' },
  { name: 'Yaksha Comics', url: 'https://yakshacomics.com/', lang: 'en' },
  { name: 'ZinManga', url: 'https://mangazin.org/', lang: 'en' }
]

const bare = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The directory sites not added yet (matched by host, so www. or a trailing path makes no difference). */
export function notYetAdded(added: { baseUrl: string }[]): DirectorySite[] {
  const have = new Set(added.map((s) => bare(s.baseUrl)))
  return SITE_DIRECTORY.filter((s) => !have.has(bare(s.url)))
}
