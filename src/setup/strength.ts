// The app's strength meter (mobile/lib/features/lock/password_strength.dart): five checks, the
// level is how many pass, and a password under twelve characters is never above "fair".

export const minLength = 12

export const checks = ['length', 'uppercase', 'lowercase', 'number', 'special'] as const

export function longEnough(password: string): boolean {
  return [...password].length >= minLength
}

/** Which of the five checks pass, and how many. */
export function passwordScore(password: string): { score: number; passed: boolean[] } {
  const passed = [
    longEnough(password),
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  return { score: passed.filter(Boolean).length, passed }
}

/** The level 0 (very weak) to 4 (very strong) and how many of the five bars are lit. */
export function passwordStrength(password: string): { level: number; bars: number } {
  const { score } = passwordScore(password)
  if (!longEnough(password)) return { level: Math.min(score, 2), bars: Math.min(score, 2) }
  return { level: Math.min(score, 4), bars: score }
}

/** Twelve characters or more, three of the five checks, and the two typed alike. */
export function canMakeVault(password: string, confirm: string): boolean {
  return (
    longEnough(password) &&
    passwordScore(password).score >= 3 &&
    confirm.length > 0 &&
    password === confirm
  )
}
