import { useState } from 'react'
import Home from './components/Home'
import IndividualForm from './components/IndividualForm'
import GroupForm from './components/GroupForm'

export default function App() {
  const [view, setView] = useState('home') // home | individual | group

  return (
    <div className="page">
      <div className="bg-half bg-left">
        <div className="bg-left-image" />
      </div>
      <div className="bg-half bg-right">
        <div className="card">
          <img src="/logo.jpg" alt="Logo" className="site-logo" />
          {view === 'home' && <Home onSelect={setView} />}
          {view === 'individual' && <IndividualForm onBack={() => setView('home')} />}
          {view === 'group' && <GroupForm onBack={() => setView('home')} />}
        </div>
      </div>
    </div>
  )
}
