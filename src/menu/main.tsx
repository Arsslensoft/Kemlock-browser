// The in-page menu, an extension page the content script shows in a frame the page can't read (design decision 4).
import { render } from 'preact'

function Menu() {
  return <main>Kemlock</main>
}

render(<Menu />, document.getElementById('app')!)
