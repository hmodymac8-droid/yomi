/**
 * A fake "verify you are human" page (known as ClickFix): it copies a command and asks you to paste it into Run
 * (Win+R) or a terminal, which installs malware. A real check never asks that. Hacked sites and their ads show them.
 */
export const FAKE_CHECK_RE =
  /win(?:dows)?(?:\s*(?:logo\s*)?(?:key|button))?\s*\+\s*r\b|⊞\s*\+?\s*r\b|\bpress\s+(?:the\s+)?win(?:dows)?\b|run dialog|ctrl\s*\+\s*v[\s\S]{0,120}?(?:enter|run\b)|paste[\s\S]{0,80}?(?:terminal|powershell|run box|command prompt)|powershell|mshta/i

/** What such a page leaves on the clipboard. */
export const COMMAND_RE =
  /powershell|pwsh|mshta|\bcmd(?:\.exe)?\s+\/[ck]\b|\biex\b|\birm\s|\bcurl(?:\.exe)?\s|\bwget\s|bitsadmin|rundll32|regsvr32|certutil|msiexec|\s-e(?:nc(?:odedcommand)?)?\s+[A-Za-z0-9+/=]{20}/i
