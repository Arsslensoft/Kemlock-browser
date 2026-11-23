// The setup tab, also the "set up again" and access steps (design decision 3).
import '../shared/fonts.css'
import '../shared/tokens.css'
import './setup.css'
import { render } from 'preact'
import { App } from './App'

render(<App />, document.getElementById('app')!)
