// What the passkey provider is asked for in one request (the same as the background registers its scripts on): access to all sites and
// the frame list. The popup can't import the background's module, which reads the browser's API at load.
export const passkeyAccess: chrome.permissions.Permissions = {
  origins: ['<all_urls>'],
  permissions: ['webNavigation'],
}
