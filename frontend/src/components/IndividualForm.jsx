import { useState } from 'react'
import { NAMES } from '../config/names'
import { submitEntry } from '../services/submissions'
import DateField, { dateError } from './DateField'
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
    const dateMsg = dateError(form.date)
    if (dateMsg) next.date = dateMsg
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

        <DateField
          value={form.date}
          onChange={(date) => setForm((f) => ({ ...f, date }))}
          error={errors.date}
        />

        <button type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Submitting…' : 'Submit'}
        </button>

        {status === 'success' && <p className="status success">{statusMessage}</p>}
        {status === 'error' && <p className="status error">{statusMessage}</p>}
      </form>
    </>
  )
}
