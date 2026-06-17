import { Routes, Route } from 'react-router-dom'
import { MemphisGate } from '@thebes/sdk'
import { Layout } from './components/Layout'
import { Contacts } from './pages/Contacts'
import { ContactDetail } from './pages/ContactDetail'
import { PipelinePage } from './pages/Pipeline'

export function App() {
  return (
    <MemphisGate appName="Relay" tagline="Sign in to your pipeline.">
      <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Contacts />} />
        <Route path="/c/:id" element={<ContactDetail />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="*" element={<Contacts />} />
      </Route>
    </Routes>
    </MemphisGate>
  )
}
