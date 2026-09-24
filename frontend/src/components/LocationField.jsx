import { LOCATIONS } from '../config/locations'

export const OTHER = 'Other'

// Resolves the submitted location: the typed value when "Other" is picked.
export function resolveLocation({ location, otherLocation }) {
  return (location === OTHER ? otherLocation : location).trim()
}

export default function LocationField({ location, otherLocation, onChange, error }) {
  return (
    <div className="field">
      <label htmlFor="location">Location</label>
      <select id="location" value={location} onChange={(e) => onChange({ location: e.target.value })}>
        <option value="">Select a location</option>
        {LOCATIONS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value={OTHER}>Other</option>
      </select>
      {location === OTHER && (
        <input
          type="text"
          aria-label="Other location"
          placeholder="Type your location"
          value={otherLocation}
          onChange={(e) => onChange({ otherLocation: e.target.value })}
          autoFocus
        />
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
