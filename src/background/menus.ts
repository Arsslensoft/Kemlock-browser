// The right-click menu of an editable field (browser-autofill spec, "Any field fills from the right-click
// menu"): Kemlock › Fill login, Fill code, New password. Its names are the same locked or not.

export type MenuAction = 'login' | 'code' | 'newPassword'

export const parentMenuId = 'kemlock'
export const menuItems: Readonly<Record<string, { action: MenuAction; title: string }>> = {
  'kemlock-fill-login': { action: 'login', title: 'bgMenuFillLogin' },
  'kemlock-fill-code': { action: 'code', title: 'bgMenuFillCode' },
  'kemlock-new-password': { action: 'newPassword', title: 'bgMenuNewPassword' },
}

/** Makes the menu again from nothing, as the browser keeps it only until the extension updates. */
export async function createMenus(): Promise<void> {
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: parentMenuId,
    title: chrome.i18n.getMessage('extName'),
    contexts: ['editable'],
  })
  for (const [id, { title }] of Object.entries(menuItems)) {
    chrome.contextMenus.create({
      id,
      parentId: parentMenuId,
      title: chrome.i18n.getMessage(title),
      contexts: ['editable'],
    })
  }
}
