import { useState } from 'react'
import { NAMES } from '../config/names'
import { submitEntry } from '../services/submissions'
import LocationField, { OTHER, resolveLocation } from './LocationField'

const EMPTY_FORM = { names: [], location: '', otherLocation: '', date: '' }

export default function GroupForm({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [statusMessage, setStatusMessage] = useState('')

  function validate() {
    const next = {}
    if (form.names.length === 0) next.names = 'Select at least one name.'
    if (!resolveLocation(form)) next.location = form.location === OTHER ? 'Please type your location.' : 'Please select a location.'
    if (!form.date) next.date = 'Date is required.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function toggleName(n) {
    setForm((f) => ({
      ...f,
      names: f.names.includes(n) ? f.names.filter((x) => x !== n) : [...f.names, n],
    }))
  }

  function handleChange(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (status === 'submitting') return // prevent duplicate submits
    if (!validate()) return

    setStatus('submitting')
    setStatusMessage('')
    try {
      const result = await submitEntry({
        type: 'Group',
        name: form.names.join(', '),
        location: resolveLocation(form),
        date: form.date,
      })
      setStatus('success')
      setStatusMessage(result.message || 'Submission saved successfully.')
      setForm(EMPTY_FORM)
      setErrors({})
    } catch (err) {
      setStatus('error')
      setStatusMessage(err.message || 'Something went wrong. Please try again.')
    }
  }

  return (
    <>
      <button type="button" className="back-link" onClick={onBack}>
        ← Back
      </button>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label>Names</label>

          {form.names.length > 0 && (
            <div className="selected-chips">
              {form.names.map((n) => (
                <span key={n} className="chip">
                  {n}
                  <button
                    type="button"
                    className="chip-remove"
                    aria-label={`Remove ${n}`}
                    onClick={() => toggleName(n)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="name-checklist">
            {NAMES.map((n) => (
              <label key={n} className="name-checkbox">
                <input type="checkbox" checked={form.names.includes(n)} onChange={() => toggleName(n)} />
                {n}
              </label>
            ))}
          </div>
          {errors.names && <p className="error">{errors.names}</p>}
        </div>

        <LocationField
          location={form.location}
          otherLocation={form.otherLocation}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          error={errors.location}
        />

        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={form.date} onChange={handleChange('date')} />
          {errors.date && <p className="error">{errors.date}</p>}
        </div>

        <button type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Submitting…' : 'Submit'}
        </button>

        {status === 'success' && <p className="status success">{statusMessage}</p>}
        {status === 'error' && <p className="status error">{statusMessage}</p>}
      </form>
    </>
  )
}
