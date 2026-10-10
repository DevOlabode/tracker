import { useEffect, useState } from 'react'
import { searchMembers, SEARCH_MIN_CHARS } from '../services/members'

// Type-to-search box for member names. Calls onSelect({ id, label }) when a result is
// picked; `exclude` hides ids already chosen (group form).
export default function MemberSearch({ id, onSelect, exclude = [], placeholder = 'Start typing your name' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | searching | done | error

  const ready = query.replace(/[^\p{L}]/gu, '').length >= SEARCH_MIN_CHARS

  useEffect(() => {
    if (!ready) {
      setResults([])
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('searching')
    // Wait for a pause in typing before asking the spreadsheet.
    const timer = setTimeout(async () => {
      try {
        const found = await searchMembers(query.trim())
        if (!cancelled) {
          setResults(found)
          setStatus('done')
        }
      } catch (err) {
        console.error('Member search failed', err)
        if (!cancelled) setStatus('error')
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, ready])

  const shown = results.filter((m) => !exclude.includes(m.id))

  function pick(member) {
    onSelect(member)
    setQuery('')
    setResults([])
    setStatus('idle')
  }

  return (
    <div className="member-search">
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!ready && query && <p className="hint">Type at least {SEARCH_MIN_CHARS} letters.</p>}
      {status === 'searching' && <p className="hint">Searching…</p>}
      {status === 'error' && <p className="error">Couldn't search right now. Please try again.</p>}
      {status === 'done' && shown.length === 0 && (
        <p className="hint">No match. Check the spelling, or ask a leader to add you.</p>
      )}
      {status === 'done' && shown.length > 0 && (
        <ul className="search-results">
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className="search-result" onClick={() => pick(m)}>
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
