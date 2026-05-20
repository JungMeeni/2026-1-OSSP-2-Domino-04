import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { runBackendTests } from './apis/backend_test.ts'
import './index.css'
import App from './App.tsx'

//runBackendTests();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
