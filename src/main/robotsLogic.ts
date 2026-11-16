// Reading robots.txt (no Electron here, so it can be tested on its own).

export interface Rule {
  allow: boolean
  re: RegExp
  length: number
}
export interface Robots {
  rules: Rule[]
  sitemaps: string[]
}

function patternToRegExp(p: string): RegExp {
  const anchored = p.endsWith('$')
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
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
    } else {
      // Any other line (Crawl-delay, …) also ends the list of user agents: "User-agent: *" then "Crawl-delay: 20"
      // then "User-agent: AhrefsBot / Disallow: /" must not block everyone.
      inRules = true
    }
  }
  return { rules, sitemaps }
}
