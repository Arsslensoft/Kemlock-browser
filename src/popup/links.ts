// Opening the extension's other pages from the popup (the popup closes when a tab opens).

/** The setup tab; `again` or `signin` re-runs the steps (a new place, a new sign-in) by the hash setup reads. */
export function openSetup(step: 'again' | 'signin' | '' = ''): void {
  const url = chrome.runtime.getURL(`src/setup/index.html${step === '' ? '' : `#${step}`}`)
  void chrome.tabs.create({ url })
}

/**
 * The tab the popup is about when it is opened as a tab (`index.html?tabId=<id>`, how the browser
 * tests drive it, since the toolbar popup can't be); the toolbar popup has no query and is about
 * the tab in front.
 */
export function requestedTab(): number | undefined {
  const search = typeof location === 'undefined' ? '' : location.search
  const raw = new URLSearchParams(search).get('tabId')
  if (raw === null || !/^\d{1,10}$/.test(raw)) return undefined
  return Number(raw)
}
