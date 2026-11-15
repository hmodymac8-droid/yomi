/*
 * Chapter rows often print the chapter and its age side by side ("Chapter 59" and "16 months ago"). When a page gives
 * the two without a space between them ("Chapter 5916 months ago") the first number read is wrong (5916), and it
 * changes as the chapter ages, so an old chapter keeps looking like a new one. These helpers undo that.
 */

/** Words that follow an age: "16 months ago", "3h", "2 d", "yesterday". */
const AGE_AFTER = /^\s*(?:s|sec|secs|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|mos|months?|y|yrs?|years?)\b/i

/**
 * The real number when the title's number is the link's chapter number with an age glued on. `titleNum` is the
 * number read from the title, `rest` the title text right after it, `urlNum` the number in the chapter's address.
 */
export function unglueNumber(titleNum: string, rest: string, urlNum: string | null): string {
  if (!urlNum || titleNum === urlNum) return titleNum
  if (!titleNum.startsWith(urlNum) || titleNum.length <= urlNum.length) return titleNum
  return AGE_AFTER.test(rest) ? urlNum : titleNum
}
