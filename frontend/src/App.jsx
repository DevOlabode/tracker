import { useState } from 'react'
import Home from './components/Home'
import IndividualForm from './components/IndividualForm'
import GroupForm from './components/GroupForm'

export default function App() {
  const [view, setView] = useState('home') // home | individual | group

  return (
    <div className={view === 'home' ? 'page page-home' : 'page'}>
      {view === 'home' && <img src="/images/logo.jpg" alt="Logo" className="logo" />}
      <div className="card">
        <h1>SUBMIT ENTRY</h1>
        {view === 'home' && <Home onSelect={setView} />}
        {view === 'individual' && <IndividualForm onBack={() => setView('home')} />}
        {view === 'group' && <GroupForm onBack={() => setView('home')} />}
      </div>
    </div>
  )
}
