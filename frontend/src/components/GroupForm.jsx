import { useState } from 'react'
import { submitEntry } from '../services/submissions'
import MemberSearch from './MemberSearch'
import DateField, { dateError } from './DateField'
import LocationField, { OTHER, resolveLocation } from './LocationField'

const EMPTY_FORM = { members: [], location: '', otherLocation: '', date: '' }

export default function GroupForm({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [statusMessage, setStatusMessage] = useState('')

  function validate() {
    const next = {}
    if (form.members.length === 0) next.names = 'Add at least one name.'
    if (!resolveLocation(form)) next.location = form.location === OTHER ? 'Please type your location.' : 'Please select a location.'
    const dateMsg = dateError(form.date)
    if (dateMsg) next.date = dateMsg
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function addMember(member) {
    setForm((f) => (f.members.some((m) => m.id === member.id) ? f : { ...f, members: [...f.members, member] }))
  }

  function removeMember(id) {
    setForm((f) => ({ ...f, members: f.members.filter((m) => m.id !== id) }))
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
        memberIds: form.members.map((m) => m.id),
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

          {form.members.length > 0 && (
            <div className="selected-chips">
              {form.members.map((m) => (
                <span key={m.id} className="chip">
                  {m.label}
                  <button
                    type="button"
                    className="chip-remove"
                    aria-label={`Remove ${m.label}`}
                    onClick={() => removeMember(m.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <MemberSearch
            onSelect={addMember}
            exclude={form.members.map((m) => m.id)}
            placeholder="Type a name to add someone"
          />
          {errors.names && <p className="error">{errors.names}</p>}
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
