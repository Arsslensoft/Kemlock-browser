// A login's websites, each with the rule that says how closely an address must match for autofill to offer the login: the editor
// the login's form uses, and the line the login's page shows. Behaviour and wording are the web vault's (WebsitesEditor, siteRows).
import type { MatchRule, WebsiteRuleView } from '../shared/api'
import { Button, IconButton, SelectField, TextField } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { hostOf } from './format'

/** The most websites a login takes (the background refuses more). */
export const maxSites = 50

/** One website as the form holds it. */
export interface SiteRow {
  uri: string
  match: MatchRule
}

/** The rules a person picks from, in the order the form lists them. */
export const ruleChoices: MatchRule[] = ['domain', 'host', 'startsWith', 'exact', 'regex', 'never']

/** The name of a rule, as a person says it. */
export function ruleName(match: MatchRule): string {
  return t(`extras_rule_${match}`)
}

/** A row for a website about to be typed: on the base-domain rule. */
export const newSiteRow = (uri = '', match: MatchRule = 'domain'): SiteRow => ({ uri, match })

/** The rules a login holds now: its own, else its websites on the default rule. */
export function rulesOf(login: {
  websites: string[]
  websiteRules?: WebsiteRuleView[]
}): WebsiteRuleView[] {
  return login.websiteRules !== undefined && login.websiteRules.length > 0
    ? login.websiteRules
    : login.websites.map((uri) => ({ uri, match: 'default' as const }))
}

/**
 * The rows of a login: its rules, or its websites on the default rule when the view carries no rules. A login with none gets one
 * empty row to type in; `fallback` fills a new login (from a generated password).
 */
export function siteRowsOf(
  login: { websites: string[]; websiteRules?: WebsiteRuleView[] } | undefined,
  fallback: string[] = [],
): SiteRow[] {
  const rules = login === undefined ? fallback.map((uri) => newSiteRow(uri)) : rulesOf(login)
  return rules.length > 0
    ? rules.map((rule) => ({ uri: rule.uri, match: rule.match }))
    : [newSiteRow()]
}

/** What the rows say to the core: the websites that were typed (a blank row is dropped), trimmed. */
export function siteRulesOf(rows: SiteRow[]): WebsiteRuleView[] {
  return rows
    .map((row) => ({ uri: row.uri.trim(), match: row.match }))
    .filter((row) => row.uri !== '')
}

/** Whether the rows say what the login holds already (a blank row aside), so a save has no websites to write. */
export function sameSites(
  rows: SiteRow[],
  login: { websites: string[]; websiteRules?: WebsiteRuleView[] },
): boolean {
  const typed = siteRulesOf(rows)
  const held = rulesOf(login)
  return (
    typed.length === held.length &&
    typed.every((rule, i) => rule.uri === held[i]!.uri.trim() && rule.match === held[i]!.match)
  )
}

const scheme = /^([a-z][a-z0-9+.-]*):/i
/** `localhost:8080`, `intranet.local:8443/app`: a host and a port, which the scheme test takes for a scheme. */
const hostPort = /^([a-z0-9.-]+):\d{1,5}(?:[/?#].*)?$/i
/** The schemes a website may use: the web, and the package names the phone apps write. */
const schemes = ['http', 'https', 'androidapp', 'iosapp']

/**
 * What is wrong with a row, if anything. A blank row is not wrong (it is dropped when saved). An address is a host
 * (`github.com`), a web address or an app's package name; a regular expression has to be one. Anything else, such as
 * `javascript:`, is refused. The scheme is looked at first: `host:port` passes only for `localhost` or a dotted host, so
 * `javascript:1/alert(1)` is no host with a port.
 */
export function siteProblem(row: SiteRow): string | undefined {
  const text = row.uri.trim()
  if (text === '') return undefined
  if (row.match === 'regex') {
    try {
      new RegExp(text)
      return undefined
    } catch {
      return t('extras_siteBadRegex')
    }
  }
  const found = scheme.exec(text)?.[1]?.toLowerCase()
  if (found === undefined) return /\s/.test(text) ? t('extras_siteBad') : undefined
  if (!schemes.includes(found)) {
    // `localhost:8080` looks like a scheme and is a host with a port; `javascript:1/alert(1)` has no such host
    const host = hostPort.exec(text)?.[1]?.toLowerCase()
    return host !== undefined && (host === 'localhost' || host.includes('.'))
      ? undefined
      : t('extras_siteBad')
  }
  if (found === 'http' || found === 'https') {
    try {
      return new URL(text).host === '' ? t('extras_siteBad') : undefined
    } catch {
      return t('extras_siteBad')
    }
  }
  return undefined
}

/** The first problem in the rows, if there is one. */
export function sitesProblem(rows: SiteRow[]): string | undefined {
  for (const row of rows) {
    const problem = siteProblem(row)
    if (problem !== undefined) return problem
  }
  return undefined
}

/**
 * The websites in a login's form: a row each with its address and rule, add and remove. `showProblems` marks the rows that need
 * fixing (after a save that was refused).
 */
export function SitesEditor(props: {
  value: SiteRow[]
  onChange: (next: SiteRow[]) => void
  showProblems?: boolean
  /** The label of an address box; "Website" by default. */
  label?: string
}) {
  const { value } = props
  const change = (index: number, patch: Partial<SiteRow>) =>
    props.onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div class="stack sites">
      {value.map((row, index) => {
        const problem = props.showProblems === true ? siteProblem(row) : undefined
        // The default rule is offered only to a website that has it already
        const choices =
          row.match === 'default' ? (['default', ...ruleChoices] as MatchRule[]) : ruleChoices
        return (
          <div
            key={index}
            class="site-row"
            role="group"
            aria-label={t('extras_websiteN', index + 1)}
          >
            <TextField
              label={props.label ?? t('popup_fieldWebsite')}
              value={row.uri}
              type="url"
              placeholder="example.com"
              invalid={problem !== undefined}
              {...(problem === undefined ? {} : { hint: problem })}
              onInput={(uri) => change(index, { uri })}
              trailing={
                value.length > 1 ? (
                  <IconButton
                    icon="x"
                    size={16}
                    weight={2}
                    label={t(
                      'popup_removeWebsite',
                      row.uri.trim() === '' ? String(index + 1) : hostOf(row.uri),
                    )}
                    onClick={() => props.onChange(value.filter((_, i) => i !== index))}
                  />
                ) : undefined
              }
            />
            <SelectField
              stacked
              label={t('extras_ruleOfN', index + 1)}
              value={row.match}
              options={choices.map((match) => ({ value: match, label: ruleName(match) }))}
              onChange={(match) => change(index, { match })}
            />
          </div>
        )
      })}
      <div class="actions start">
        <Button
          kind="ghost"
          icon="plus"
          disabled={value.length >= maxSites}
          onClick={() => props.onChange([...value, newSiteRow()])}
        >
          {t('popup_addWebsite')}
        </Button>
      </div>
      <p class="strength-line">{t('extras_sitesHint')}</p>
    </div>
  )
}

/** A website on a login's page: its host (the address as written for a regular expression) and the rule it is on. */
export function SiteRuleLine(props: { rule: WebsiteRuleView }) {
  const { rule } = props
  const shown = rule.match === 'regex' ? rule.uri : hostOf(rule.uri)
  return (
    <span class="site-rule-line">
      <span class="ellipsis">{shown}</span>
      {rule.match !== 'default' && (
        <span class={rule.match === 'never' ? 'label warn-text' : 'label'}>
          {ruleName(rule.match)}
        </span>
      )}
    </span>
  )
}
