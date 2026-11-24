// A fixed public key for the extension the tests load, so its id is the same on every run and on
// every machine: Chrome derives an unpacked extension's id from the key in its manifest (and, with
// none, from the folder it is loaded from, which the tests make new each time). It is a public
// key; its private half was never kept, and nothing is signed with it.
//
// This is the id to put in Kemlock Server's KEMLOCK_BROWSER_EXTENSION_IDS to run the SSO test.
export const EXTENSION_ID = 'nneomjbinpcemfdjdgoaekdpekbcoomj'
export const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwe64OCWKW2dnTW/c/TMRf+zbAG5u1LsLpZ2Iljph9PG669Dt2ySP05hIS5fQE1asVQn9UNU5O6gngmz2UXnG4jhDpyHMtub4w0xJUrJcKZ/8KkdINPthtPm/+vfOXX0gvBnEFz4/dnnesUOir8o7RCvil+C+rk0C4dB2ixblJEWCtFkqOHYn4UidAjzJX+UwyGHlJcKcIkZyzTcKSyX6qhNGx+ztj58oncWTmARUWqNZNeX7EgD35zkJT0oxwr0BJe7X3X8Qd/UGpZbzy77V9BXSDCsLJrQdDHX6ojciisOqHU+3Su+8or/rczdiq+iTMFgjHHXdvjwsHL22+6pUKwIDAQAB'
