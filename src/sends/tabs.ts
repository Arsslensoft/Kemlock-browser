// Opening other tabs from the Sends tab.

/** The setup tab, at its "set up again" steps. */
export function openSetupTab(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html#again') })
}

/** A web page in a tab of its own (a Bitwarden Send's link, which Kemlock doesn't open). Only an https address. */
export function openLinkInTab(address: string): void {
  try {
    if (new URL(address).protocol === 'https:') void chrome.tabs.create({ url: address })
  } catch {
    // Not an address: nothing to open
  }
}

/**
 * The token a note's draft is named by, in the address the popup opened this tab with (`#new:<token>`), or undefined. Only the token is
 * in the address: the note's text goes from the background to this tab and is in no address.
 */
export function draftTokenOf(hash: string): string | undefined {
  return /^#new:([A-Za-z0-9-]{1,64})$/.exec(hash)?.[1]
}
