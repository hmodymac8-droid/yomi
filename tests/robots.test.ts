import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRobots, type Robots } from '../src/main/robotsLogic.ts'

/** Same rule as robots.ts: longest matching rule wins, Allow beats Disallow on a tie, no match means allowed. */
function allows(r: Robots, path: string): boolean {
  let best: Robots['rules'][number] | null = null
  for (const x of r.rules) {
    if (!x.re.test(path)) continue
    if (!best || x.length > best.length || (x.length === best.length && x.allow)) best = x
  }
  return best ? best.allow : true
}

test('a Crawl-delay line ends the "*" group, so a later bot-only block does not apply to everyone', () => {
  const r = parseRobots(
    ['User-agent: * ', 'Crawl-Delay: 20', '# comment', 'User-agent: AhrefsBot', 'Disallow: /'].join(
      '\n'
    )
  )
  assert.equal(allows(r, '/manga/page/2/'), true)
})

test('"User-agent: *" with "Disallow: /" still blocks everything', () => {
  const r = parseRobots(
    [
      'User-agent: Mediapartners-Google',
      'Allow: /',
      'User-agent: *',
      'Allow: /ads.txt',
      'Disallow: /'
    ].join('\n')
  )
  assert.equal(allows(r, '/manga/'), false)
  assert.equal(allows(r, '/ads.txt'), true)
})

test('rules after a Crawl-delay in the same "*" group still count', () => {
  const r = parseRobots(['User-agent: *', 'Crawl-delay: 5', 'Disallow: /admin'].join('\n'))
  assert.equal(allows(r, '/admin/x'), false)
  assert.equal(allows(r, '/manga/'), true)
})

test('agents listed together share the rules that follow', () => {
  const r = parseRobots(['User-agent: Googlebot', 'User-agent: *', 'Disallow: /search'].join('\n'))
  assert.equal(allows(r, '/search?q=a'), false)
})
