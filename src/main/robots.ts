import { fetchHtml } from './http'
import { parseRobots, type Robots, type Rule } from './robotsLogic'

// The app reads each site's robots.txt and keeps to it for anything automatic (scans, update checks, sitemap
// discovery). Reading a chapter you opened yourself is just browsing, so that isn't gated.

const cache = new Map<string, { at: number; robots: Robots }>()
const TTL = 24 * 60 * 60 * 1000

export async function getRobots(origin: string): Promise<Robots> {
  const hit = cache.get(origin)
  if (hit && Date.now() - hit.at < TTL) return hit.robots
  let robots: Robots = { rules: [], sitemaps: [] }
  try {
    const r = await fetchHtml(origin + '/robots.txt', 6000)
    if (r.status === 200 && !/<html/i.test(r.html.slice(0, 300))) robots = parseRobots(r.html)
  } catch {
    /* no robots.txt reachable: nothing is restricted */
  }
  cache.set(origin, { at: Date.now(), robots })
  return robots
}

/** Longest matching rule wins; Allow beats Disallow on a tie; no match means allowed. */
export async function robotsAllows(url: string): Promise<boolean> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const { rules } = await getRobots(u.origin)
  const path = u.pathname + u.search
  let best: Rule | null = null
  for (const r of rules) {
    if (!r.re.test(path)) continue
    if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r
  }
  return best ? best.allow : true
}
