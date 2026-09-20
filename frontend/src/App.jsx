import { useState } from 'react'
import Home from './components/Home'
import IndividualForm from './components/IndividualForm'
import GroupForm from './components/GroupForm'

export default function App() {
  const [view, setView] = useState('home') // home | individual | group

  return (
    <div className="page">
      <div className="card">
        <h1>Submit Entr</h1>
        {view === 'home' && <Home onSelect={setView} />}
        {view === 'individual' && <IndividualForm onBack={() => setView('home')} />}
        {view === 'group' && <GroupForm onBack={() => setView('home')} />}
      </div>
    </div>
  )
}
