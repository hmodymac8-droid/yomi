import { fetchHtml } from './http'

// The app reads each site's robots.txt and keeps to it for anything automatic (scans, update checks, sitemap
// discovery). Reading a chapter you opened yourself is just browsing, so that isn't gated.

interface Rule {
  allow: boolean
  re: RegExp
  length: number
}
interface Robots {
  rules: Rule[]
  sitemaps: string[]
}

const cache = new Map<string, { at: number; robots: Robots }>()
const TTL = 24 * 60 * 60 * 1000

function patternToRegExp(p: string): RegExp {
  const anchored = p.endsWith('$')
  const body = (anchored ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp('^' + body + (anchored ? '$' : ''))
}

export function parseRobots(text: string): Robots {
  const rules: Rule[] = []
  const sitemaps: string[] = []
  let agents: string[] = []
  let inRules = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'sitemap') {
      if (val) sitemaps.push(val)
    } else if (key === 'user-agent') {
      if (inRules) {
        agents = []
        inRules = false
      }
      agents.push(val.toLowerCase())
    } else if (key === 'allow' || key === 'disallow') {
      inRules = true
      if (!agents.includes('*')) continue // only the rules that apply to every crawler
      if (!val) continue // "Disallow:" with nothing means nothing is disallowed
      rules.push({ allow: key === 'allow', re: patternToRegExp(val), length: val.length })
    }
  }
  return { rules, sitemaps }
}

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
