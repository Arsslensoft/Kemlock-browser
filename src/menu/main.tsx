// The in-page menu, an extension page the content script shows in a frame the page can't read (design decision 4).
// It speaks only to the content script that opened it, over the port that script hands it (channel.ts),
// and to the background, which answers extension pages by their origin.
import '../shared/fonts.css'
import '../shared/tokens.css'
import './menu.css'
import { render } from 'preact'
import { App } from './App'
import { connect, parseHash } from './channel'

const hash = parseHash(location.hash)
// Opened any other way (a page framing it, someone visiting it): nothing is shown, nothing fills
if (hash !== null) {
  void connect(hash.nonce).then(({ channel, init }) => {
    render(<App channel={channel} init={init} />, document.getElementById('app')!)
  })
}
