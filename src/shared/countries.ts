// The countries the address and document fields offer (the app's list, mobile/lib/features/identities/countries.dart): an ISO
// 3166-1 alpha-2 code with its name in English and in French. A country not here is typed, and kept as typed.

export interface Country {
  code: string
  en: string
  fr: string
}

const rows: [string, string, string][] = [
  ['AL', 'Albania', 'Albanie'],
  ['DZ', 'Algeria', 'Algérie'],
  ['AR', 'Argentina', 'Argentine'],
  ['AU', 'Australia', 'Australie'],
  ['AT', 'Austria', 'Autriche'],
  ['BE', 'Belgium', 'Belgique'],
  ['BR', 'Brazil', 'Brésil'],
  ['BG', 'Bulgaria', 'Bulgarie'],
  ['CM', 'Cameroon', 'Cameroun'],
  ['CA', 'Canada', 'Canada'],
  ['CL', 'Chile', 'Chili'],
  ['CN', 'China', 'Chine'],
  ['CO', 'Colombia', 'Colombie'],
  ['CI', 'Côte d’Ivoire', 'Côte d’Ivoire'],
  ['HR', 'Croatia', 'Croatie'],
  ['CZ', 'Czechia', 'Tchéquie'],
  ['DK', 'Denmark', 'Danemark'],
  ['EG', 'Egypt', 'Égypte'],
  ['EE', 'Estonia', 'Estonie'],
  ['FI', 'Finland', 'Finlande'],
  ['FR', 'France', 'France'],
  ['DE', 'Germany', 'Allemagne'],
  ['GR', 'Greece', 'Grèce'],
  ['HK', 'Hong Kong', 'Hong Kong'],
  ['HU', 'Hungary', 'Hongrie'],
  ['IS', 'Iceland', 'Islande'],
  ['IN', 'India', 'Inde'],
  ['ID', 'Indonesia', 'Indonésie'],
  ['IE', 'Ireland', 'Irlande'],
  ['IL', 'Israel', 'Israël'],
  ['IT', 'Italy', 'Italie'],
  ['JP', 'Japan', 'Japon'],
  ['KE', 'Kenya', 'Kenya'],
  ['LV', 'Latvia', 'Lettonie'],
  ['LB', 'Lebanon', 'Liban'],
  ['LT', 'Lithuania', 'Lituanie'],
  ['LU', 'Luxembourg', 'Luxembourg'],
  ['MY', 'Malaysia', 'Malaisie'],
  ['MX', 'Mexico', 'Mexique'],
  ['MA', 'Morocco', 'Maroc'],
  ['NL', 'Netherlands', 'Pays-Bas'],
  ['NZ', 'New Zealand', 'Nouvelle-Zélande'],
  ['NG', 'Nigeria', 'Nigéria'],
  ['NO', 'Norway', 'Norvège'],
  ['PK', 'Pakistan', 'Pakistan'],
  ['PE', 'Peru', 'Pérou'],
  ['PH', 'Philippines', 'Philippines'],
  ['PL', 'Poland', 'Pologne'],
  ['PT', 'Portugal', 'Portugal'],
  ['RO', 'Romania', 'Roumanie'],
  ['SA', 'Saudi Arabia', 'Arabie saoudite'],
  ['SN', 'Senegal', 'Sénégal'],
  ['RS', 'Serbia', 'Serbie'],
  ['SG', 'Singapore', 'Singapour'],
  ['SK', 'Slovakia', 'Slovaquie'],
  ['SI', 'Slovenia', 'Slovénie'],
  ['ZA', 'South Africa', 'Afrique du Sud'],
  ['KR', 'South Korea', 'Corée du Sud'],
  ['ES', 'Spain', 'Espagne'],
  ['SE', 'Sweden', 'Suède'],
  ['CH', 'Switzerland', 'Suisse'],
  ['TW', 'Taiwan', 'Taïwan'],
  ['TH', 'Thailand', 'Thaïlande'],
  ['TN', 'Tunisia', 'Tunisie'],
  ['TR', 'Türkiye', 'Turquie'],
  ['UA', 'Ukraine', 'Ukraine'],
  ['AE', 'United Arab Emirates', 'Émirats arabes unis'],
  ['GB', 'United Kingdom', 'Royaume-Uni'],
  ['US', 'United States', 'États-Unis'],
  ['UY', 'Uruguay', 'Uruguay'],
  ['VN', 'Vietnam', 'Viêt Nam'],
]

export const countries: readonly Country[] = rows.map(([code, en, fr]) => ({ code, en, fr }))

const fold = (text: string) => text.trim().toLowerCase()

/** The country with ISO code [code] (any case), or undefined. */
export function countryByCode(code: string | undefined): Country | undefined {
  if (code === undefined) return undefined
  const folded = fold(code)
  return countries.find((country) => country.code.toLowerCase() === folded)
}

/** The name of a country in [language] ('fr', else English). */
export const countryName = (country: Country, language: string): string =>
  language === 'fr' ? country.fr : country.en

/** What a stored country shows as: the name of a known code in [language], else the text as stored. */
export function countryLabel(stored: string, language: string): string {
  const country = countryByCode(stored)
  return country === undefined ? stored : countryName(country, language)
}

/** What a country field's [text] is stored as: the ISO code of a country it names (in either language) or is the code of, else the text as typed. */
export function countryStored(text: string): string {
  const folded = fold(text)
  if (folded === '') return ''
  const found = countries.find(
    (country) =>
      folded === country.en.toLowerCase() ||
      folded === country.fr.toLowerCase() ||
      folded === country.code.toLowerCase(),
  )
  return found === undefined ? text.trim() : found.code
}

/**
 * The country a page's free text names (a select's option, an input's answer), by code or by either name, ignoring case and
 * accents; undefined when it is none of them.
 */
export function countryNamed(text: string): Country | undefined {
  const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  const wanted = plain(text)
  if (wanted === '') return undefined
  return countries.find(
    (country) =>
      wanted === country.code.toLowerCase() ||
      wanted === plain(country.en) ||
      wanted === plain(country.fr),
  )
}
