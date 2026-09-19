const ENDPOINT = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL

// Content-Type must stay 'text/plain' so this qualifies as a CORS "simple
// request" — Apps Script web apps don't implement the OPTIONS preflight,
// so a JSON content-type would make the browser block the request.
export async function submitEntry({ type, name, location, date }) {
  if (!ENDPOINT) {
    throw new Error('VITE_GOOGLE_APPS_SCRIPT_URL is not configured')
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type, name, location, date }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('Apps Script request failed', response.status, body)
    throw new Error(`Request failed with status ${response.status}`)
  }

  const result = await response.json()
  if (!result.success) {
    console.error('Apps Script reported failure', result)
    throw new Error(result.message || 'Submission failed')
  }
  return result
}
