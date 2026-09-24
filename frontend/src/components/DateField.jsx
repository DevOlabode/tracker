// Local YYYY-MM-DD ('en-CA' formats that way), so it compares directly as a string.
const today = () => new Date().toLocaleDateString('en-CA')

// Returns an error message, or '' when the date is valid.
export function dateError(value) {
  if (!value) return 'Date is required.'
  const d = new Date(`${value}T00:00`)
  // Round-trip catches both bad formats and impossible dates like 2026-02-30.
  if (isNaN(d) || d.toLocaleDateString('en-CA') !== value) return 'Enter a valid date.'
  if (value > today()) return 'Date cannot be in the future.'
  return ''
}

export default function DateField({ value, onChange, error }) {
  return (
    <div className="field">
      <label htmlFor="date">Date</label>
      <input
        id="date"
        type="date"
        max={today()}
        value={value}
        // Open the calendar on any click, not just the icon.
        onClick={(e) => {
          try {
            e.currentTarget.showPicker()
          } catch {
            // Older browsers without showPicker() fall back to their default behaviour.
          }
        }}
        // Blurring after a pick closes the calendar right away.
        onChange={(e) => {
          onChange(e.target.value)
          e.target.blur()
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  )
}
