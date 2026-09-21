export default function Home({ onSelect }) {
  return (
    <div className="home">
      <p className="home-prompt">How are you submitting?</p>
      <div className="home-options">
        <button type="button" className="option" onClick={() => onSelect('individual')}>
          <span className="option-title">Individual</span>
        </button>
        <button type="button" className="option" onClick={() => onSelect('group')}>
          <span className="option-title">Group: Submit for Multiple</span>
        </button>
      </div>
    </div>
  )
}
