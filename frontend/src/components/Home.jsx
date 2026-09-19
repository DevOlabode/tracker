export default function Home({ onSelect }) {
  return (
    <div className="home">
      <p className="home-prompt">How are you submitting?</p>
      <div className="home-options">
        <button type="button" className="option" onClick={() => onSelect('individual')}>
          <span className="option-title">Individual</span>
          <span className="option-desc">Submit information for one person.</span>
        </button>
        <button type="button" className="option" onClick={() => onSelect('group')}>
          <span className="option-title">Group</span>
          <span className="option-desc">Submit information for multiple people.</span>
        </button>
      </div>
    </div>
  )
}
