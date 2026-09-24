import { useState } from 'react'
import { NAMES } from '../config/names'
import { submitEntry } from '../services/submissions'
import LocationField, { OTHER, resolveLocation } from './LocationField'

const EMPTY_FORM = { name: '', location: '', otherLocation: '', date: '' }

export default function IndividualForm({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [statusMessage, setStatusMessage] = useState('')

  function validate() {
    const next = {}
    if (!form.name) next.name = 'Please select a name.'
    if (!resolveLocation(form)) next.location = form.location === OTHER ? 'Please type your location.' : 'Please select a location.'
    if (!form.date) next.date = 'Date is required.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (status === 'submitting') return // prevent duplicate submits
    if (!validate()) return

    setStatus('submitting')
    setStatusMessage('')
    try {
      const result = await submitEntry({
        type: 'Individual',
        name: form.name,
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

  function handleChange(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  return (
    <>
      <button type="button" className="back-link" onClick={onBack}>
        ← Back
      </button>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="name">Name</label>
          <select id="name" value={form.name} onChange={handleChange('name')}>
            <option value="">Select a name</option>
            {NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {errors.name && <p className="error">{errors.name}</p>}
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
