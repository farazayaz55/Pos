import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { ensureLocalDbOpen } from '@/localdb/db'
import './index.css'

void ensureLocalDbOpen().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: { fontSize: '0.875rem' },
          }}
        />
      </BrowserRouter>
    </React.StrictMode>,
  )
})
