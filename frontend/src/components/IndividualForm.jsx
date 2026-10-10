import { useState } from 'react'
import { submitEntry } from '../services/submissions'
import { rememberedMember, rememberMember } from '../services/members'
import MemberSearch from './MemberSearch'
import DateField, { dateError } from './DateField'
import LocationField, { OTHER, resolveLocation } from './LocationField'

const EMPTY_FORM = { member: null, location: '', otherLocation: '', date: '' }

export default function IndividualForm({ onBack }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, member: rememberedMember() }))
  const [remember, setRemember] = useState(true)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [statusMessage, setStatusMessage] = useState('')

  function validate() {
    const next = {}
    if (!form.member) next.name = 'Please find and pick your name.'
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
        memberIds: [form.member.id],
        location: resolveLocation(form),
        date: form.date,
      })
      setStatus('success')
      setStatusMessage(result.message || 'Submission saved successfully.')
      rememberMember(remember ? form.member : null)
      setForm({ ...EMPTY_FORM, member: remember ? form.member : null })
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
          <label htmlFor="name">Name</label>
          {form.member ? (
            <div className="selected-chips">
              <span className="chip">
                {form.member.label}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label="Not you? Change name"
                  onClick={() => setForm((f) => ({ ...f, member: null }))}
                >
                  ×
                </button>
              </span>
            </div>
          ) : (
            <MemberSearch id="name" onSelect={(member) => setForm((f) => ({ ...f, member }))} />
          )}
          <label className="name-checkbox remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device
          </label>
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
