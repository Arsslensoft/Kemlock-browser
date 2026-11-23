// Opening the extension's other pages from the popup (the popup closes when a tab opens).

/** The setup tab; `again` re-runs the steps (a new place, a new sign-in), by a query it reads. */
export function openSetup(query = ''): void {
  const url = chrome.runtime.getURL(`src/setup/index.html${query === '' ? '' : `?${query}`}`)
  void chrome.tabs.create({ url })
}
