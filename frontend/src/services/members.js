const ENDPOINT = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL
const REMEMBER_KEY = 'tracker.me'

export const SEARCH_MIN_CHARS = 3 // keep in sync with SEARCH_MIN_CHARS in apps-script/Code.gs

// Returns up to a few matching members as { id, label } ("First L."). The full member
// list stays in the spreadsheet; only matches for what was typed come back.
export async function searchMembers(query) {
  if (!ENDPOINT) {
    throw new Error('VITE_GOOGLE_APPS_SCRIPT_URL is not configured')
  }
  const url = `${ENDPOINT}?action=searchMembers&q=${encodeURIComponent(query)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`)
  }
  const result = await response.json()
  if (!result.success) {
    throw new Error(result.message || 'Search failed')
  }
  return result.members
}

// "Remember me" lives only in this browser. Storage can be blocked (private mode), so
// failures just mean the name isn't remembered.
export function rememberedMember() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY))
    return saved && saved.id && saved.label ? saved : null
  } catch {
    return null
  }
}

export function rememberMember(member) {
  try {
    if (member) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ id: member.id, label: member.label }))
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // ignore
  }
}
