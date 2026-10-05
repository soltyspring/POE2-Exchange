import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BuildImporter } from './BuildImporter'
import { AppBoundary } from './AppBoundary'
import './BuildImporter.css'

createRoot(document.getElementById('root')!).render(<StrictMode><AppBoundary><BuildImporter/></AppBoundary></StrictMode>)
