import { safeEmailUrl, safeLinkUrl, safeWebUrl } from './safeUrl';

export interface OpportunityContextNode {
  id: string;
  label: string | null;
  text?: string;
  href?: string;
  children?: OpportunityContextNode[];
  missing?: boolean;
  kind?: 'summary' | 'main-link' | 'fit';
  score?: number;
  checklistKey?: string;
}

export type OpportunityContextGroupId = 'overview' | 'links' | 'suitability' | 'advisor' | 'salary' | 'requirements' | 'documents' | 'metadata';
export interface OpportunityContextGroup {
  id: OpportunityContextGroupId;
  label: string;
  items: OpportunityContextNode[];
}

const GROUPS: [OpportunityContextGroupId, string, string][] = [
  ['overview', 'Research overview & fit', 'Forschungsüberblick & Passung'],
  ['salary', 'Salary & funding', 'Gehalt & Finanzierung'],
  ['requirements', 'Requirements', 'Anforderungen'],
  ['documents', 'Application documents', 'Bewerbungsunterlagen'],
  ['advisor', 'Advisor & lab context', 'Betreuung & Forschungsgruppe'],
  ['links', 'Links & contacts', 'Links & Kontakte'],
  ['suitability', 'Particularly suitable', 'Besonders passend'],
  ['metadata', 'Metadata', 'Metadaten'],
];

const FIELD_GROUPS: Record<OpportunityContextGroupId, string[]> = {
  links: ['official_url', 'application_url', 'source_url', 'sources', 'links', 'contacts', 'contact', 'contact_email', 'email', 'website'],
  overview: ['research_summary', 'project_summary', 'project_description', 'personal_fit', 'research_fit',
    'research_career_potential', 'rd_career_potential', 'hardware_software_balance', 'hardware_software_profile', 'cv_track'],
  suitability: ['particularly_suitable', 'particularly_suitable_reason', 'special_features'],
  advisor: ['supervisor_research_focus', 'supervisor_top_papers', 'supervisors', 'supervisor', 'supervisor_reputation',
    'research_context', 'research_focus',
    'lab', 'lab_context', 'lab_research', 'research_group', 'unit'],
  salary: ['salary', 'salary_text', 'funding', 'compensation', 'stipend', 'scholarship', 'benefits',
    'duration_months', 'duration_details', 'duration', 'duration_years', 'contract_duration', 'contract_length', 'start_date'],
  requirements: ['requirements', 'eligibility', 'qualifications', 'required_skills', 'desired_skills', 'language_requirements'],
  documents: ['required_documents', 'application_documents', 'documents', 'submission_documents'],
  metadata: ['topics', 'keywords', 'research_topics', 'research_areas', 'research_track'],
};

const LABELS: Record<string, [string, string]> = {
  official_url: ['Official listing', 'Offizielle Ausschreibung'], application_url: ['Application portal', 'Bewerbungsportal'],
  source_url: ['Source', 'Quelle'], sources: ['Sources', 'Quellen'], links: ['Links', 'Links'],
  contact: ['Contacts', 'Kontakte'], contacts: ['Contacts', 'Kontakte'], contact_email: ['Contact email', 'Kontakt-E-Mail'],
  email: ['Email', 'E-Mail'], website: ['Website', 'Website'], url: ['Link', 'Link'], href: ['Link', 'Link'],
  supervisor_research_focus: ['Advisor research focus', 'Forschungsschwerpunkte der Betreuung'],
  supervisor_top_papers: ['Representative papers', 'Repräsentative Publikationen'],
  supervisor: ['Advisors', 'Betreuung'], supervisors: ['Advisors', 'Betreuung'],
  supervisor_reputation: ['Advisor background', 'Hintergrund der Betreuung'],
  research_career_potential: ['Academic career potential', 'Akademische Karrierechancen'],
  rd_career_potential: ['R&D career potential', 'Karrierechancen in Forschung & Entwicklung'],
  hardware_software_balance: ['Hardware / software balance', 'Hardware- / Software-Anteil'],
  hardware_software_profile: ['Hardware / software profile', 'Hardware- / Software-Profil'],
  research_fit: ['Research fit', 'Forschungspassung'],
  personal_fit: ['Personal fit', 'Persönliche Passung'], particularly_suitable: ['Particularly suitable', 'Besonders passend'],
  particularly_suitable_reason: ['Suitability rationale', 'Begründung der Passung'], special_features: ['Distinctive features', 'Besonderheiten'],
  research_context: ['Research context', 'Forschungskontext'], research_track: ['Research track', 'Forschungsschwerpunkt'],
  cv_track: ['CV track', 'CV-Schwerpunkt'], research_summary: ['Research summary', 'Forschungsüberblick'],
  project_description: ['Project description', 'Projektbeschreibung'], project_summary: ['Project summary', 'Projektüberblick'],
  research_focus: ['Research focus', 'Forschungsschwerpunkt'], focus_summary: ['Focus summary', 'Überblick der Schwerpunkte'],
  focus: ['Focus', 'Schwerpunkt'], summary: ['Summary', 'Überblick'], description: ['Description', 'Beschreibung'],
  keywords: ['Keywords', 'Schlagwörter'], topics: ['Topics', 'Themen'], research_topics: ['Research topics', 'Forschungsthemen'],
  research_areas: ['Research areas', 'Forschungsgebiete'], evidence: ['Evidence', 'Belege'], evidence_urls: ['Evidence links', 'Beleglinks'],
  limitations: ['Limitations', 'Einschränkungen'], papers: ['Papers', 'Publikationen'], publications: ['Publications', 'Publikationen'],
  title: ['Title', 'Titel'], year: ['Year', 'Jahr'], venue: ['Venue', 'Publikationsort'], journal: ['Journal', 'Fachzeitschrift'],
  authors: ['Authors', 'Autorinnen und Autoren'], doi: ['DOI', 'DOI'], selection_basis: ['Selection basis', 'Auswahlgrundlage'],
  why_relevant: ['Relevance to the opportunity', 'Bezug zur Stelle'], citations: ['Citations', 'Zitationen'],
  citation_count: ['Citation count', 'Anzahl Zitationen'], name: ['Name', 'Name'], role: ['Role', 'Rolle'],
  scientific_contact: ['Scientific contact', 'Wissenschaftlicher Kontakt'], administrative_contact: ['Administrative contact', 'Administrativer Kontakt'],
  main_supervisor: ['Main advisor', 'Hauptbetreuung'], co_supervisor: ['Co-advisor', 'Mitbetreuung'],
  assessment: ['Assessment', 'Einschätzung'], reason: ['Rationale', 'Begründung'], details: ['Details', 'Details'],
  salary: ['Salary', 'Gehalt'], salary_text: ['Salary', 'Gehalt'], funding: ['Funding', 'Finanzierung'],
  compensation: ['Compensation', 'Vergütung'], stipend: ['Stipend', 'Stipendium'], scholarship: ['Scholarship', 'Stipendium'],
  benefits: ['Benefits', 'Zusatzleistungen'], model: ['Pay model', 'Vergütungsmodell'], amount: ['Amount', 'Betrag'],
  min: ['Minimum', 'Minimum'], max: ['Maximum', 'Maximum'], currency: ['Currency', 'Währung'], period: ['Period', 'Zeitraum'],
  gross: ['Gross', 'Brutto'], net: ['Net', 'Netto'], monthly: ['Monthly', 'Monatlich'], annually: ['Annually', 'Jährlich'],
  requirements: ['Requirements', 'Anforderungen'], eligibility: ['Eligibility', 'Zulassungsvoraussetzungen'],
  qualifications: ['Qualifications', 'Qualifikationen'], required_skills: ['Required skills', 'Erforderliche Kenntnisse'],
  desired_skills: ['Desired skills', 'Gewünschte Kenntnisse'], language_requirements: ['Language requirements', 'Sprachkenntnisse'],
  required_documents: ['Required documents', 'Erforderliche Unterlagen'], application_documents: ['Application documents', 'Bewerbungsunterlagen'],
  documents: ['Documents', 'Unterlagen'], submission_documents: ['Submission documents', 'Einzureichende Unterlagen'],
  institution: ['Institution', 'Einrichtung'], university: ['Institution', 'Einrichtung'], unit: ['Department / group', 'Fachbereich / Gruppe'],
  country: ['Country', 'Land'], city: ['City', 'Stadt'], position_type: ['Position type', 'Art der Stelle'],
  duration_months: ['Duration (months)', 'Dauer (Monate)'], duration_details: ['Duration details', 'Angaben zur Dauer'],
  deadline: ['Application deadline', 'Bewerbungsfrist'], deadline_time_local: ['Deadline time', 'Uhrzeit der Frist'],
  deadline_timezone: ['Deadline timezone', 'Zeitzone der Frist'], deadline_original_text: ['Original deadline wording', 'Frist im Original'],
  start_date: ['Start date', 'Beginn'], availability: ['Availability', 'Verfügbarkeit'], opportunity_key: ['Reference', 'Referenz'],
  vacancy_id: ['Vacancy reference', 'Ausschreibungsnummer'], record_type: ['Record type', 'Art des Eintrags'],
  verification_level: ['Verification', 'Verifizierungsstand'], historical_match_status: ['Historical match', 'Historische Zuordnung'],
  source_context: ['Source context', 'Quellenkontext'], open_questions: ['Open questions', 'Offene Fragen'],
  metadata_schema_version: ['Record format version', 'Version des Datensatzformats'], created_at: ['Added', 'Hinzugefügt'],
  updated_at: ['Updated', 'Aktualisiert'], last_checked_at: ['Last checked', 'Zuletzt geprüft'],
  checked_at: ['Checked', 'Geprüft'], context_captured_at: ['Context captured', 'Kontext gespeichert'],
  historical_context: ['Historical context', 'Historischer Kontext'], official_listing: ['Official listing', 'Offizielle Ausschreibung'],
  open: ['Open', 'Offen'], closed: ['Closed', 'Geschlossen'], unknown: ['Unknown', 'Unbekannt'],
  matched: ['Matched', 'Zugeordnet'], probable: ['Probable', 'Wahrscheinlich'], unresolved: ['Unresolved', 'Ungeklärt'],
};

const ALIASES: Record<string, string> = { university: 'institution', supervisor: 'supervisors', contact: 'contacts',
  salary_text: 'salary', application_documents: 'required_documents', documents: 'required_documents' };
const PRIVATE_KEYS = new Set(['id', 'user_id']);
const FIT_FIELDS = new Set(['personal_fit', 'research_fit', 'research_career_potential', 'rd_career_potential']);
const SUMMARY_FIELDS = new Set(['research_summary', 'project_summary', 'project_description']);
const PRIMARY_LINK_FIELDS = ['official_url', 'application_url', 'source_url'];
const ENUM_KEYS = new Set(['role', 'availability', 'verification_level', 'historical_match_status', 'period']);

function keyName(value: string) { return value.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/[ -]+/g, '_'); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function phrase(en: string, de: string, lang: string) { return lang === 'de' ? de : en; }

function fitScore(value: unknown): number | undefined {
  const raw = isRecord(value) ? value.score : value;
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()))) return;
  const score = Number(raw);
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : undefined;
}

export function opportunityFieldLabel(key: string, lang: string): string {
  const known = LABELS[keyName(key)];
  if (known) return known[lang === 'de' ? 1 : 0];
  const words = key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1))
    .replace(/\b(?:url|doi|cv|ai|id|orcid|isbn)\b/gi, (value) => value.toUpperCase());
}

function humanText(value: string | number | boolean, key: string, lang: string): string {
  if (typeof value === 'boolean') return phrase(value ? 'Yes' : 'No', value ? 'Ja' : 'Nein', lang);
  if (typeof value === 'number') return key === 'year' ? String(value) : new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB').format(value);
  if (ENUM_KEYS.has(key) && LABELS[keyName(value)]) return opportunityFieldLabel(value, lang);
  if ((key.endsWith('_at') || key === 'start_date' || key === 'deadline') && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', value.length === 10
        ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
  }
  return value.trim();
}

function safeHref(value: string, key: string): string | null {
  const web = safeWebUrl(value);
  if (web) return web;
  if (/^mailto:/i.test(value)) return safeLinkUrl(value);
  const email = safeEmailUrl(value);
  if (email) return email;
  if (key === 'doi' && /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/.test(value)) {
    return safeWebUrl(`https://doi.org/${encodeURIComponent(value).replace(/%2F/g, '/')}`);
  }
  return null;
}

function buildNode(value: unknown, key: string, id: string, lang: string, ancestors: Set<object>, label: string | null): OpportunityContextNode | null {
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = humanText(value, keyName(key), lang);
    if (!text) return null;
    const href = typeof value === 'string' ? safeHref(value.trim(), keyName(key)) : null;
    return { id, label, text, ...(href ? { href } : {}) };
  }
  if (typeof value !== 'object' || ancestors.has(value)) return null;
  const nextAncestors = new Set(ancestors).add(value);
  const children = Array.isArray(value)
    ? value.map((item, index) => {
      if (isRecord(item)) {
        const headingKey = ['name', 'title', 'label', 'document', 'requirement'].find((candidate) => typeof item[candidate] === 'string' && String(item[candidate]).trim());
        if (headingKey) {
          const heading = String(item[headingKey]).trim();
          const detail = Object.fromEntries(Object.entries(item).filter(([childKey]) => childKey !== headingKey));
          return buildNode(detail, key, `${id}.${index}`, lang, nextAncestors, heading)
            || buildNode(heading, key, `${id}.${index}`, lang, nextAncestors, null);
        }
      }
      return buildNode(item, key, `${id}.${index}`, lang, nextAncestors, null);
    }).filter((item): item is OpportunityContextNode => item !== null)
    : Object.entries(value).filter(([childKey]) => !PRIVATE_KEYS.has(childKey))
      .map(([childKey, item]) => buildNode(item, childKey, `${id}.${childKey}`, lang, nextAncestors, opportunityFieldLabel(childKey, lang)))
      .filter((item): item is OpportunityContextNode => item !== null);
  return children.length ? { id, label, children } : null;
}

function fieldGroup(key: string): OpportunityContextGroupId {
  const normalized = keyName(key);
  for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
    if (keys.includes(normalized)) return group as OpportunityContextGroupId;
  }
  if (/(?:^|_)(?:url|urls|link|links|email)$/.test(normalized)) return 'links';
  return 'metadata';
}

function checklistValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return null;
  const next = new Set(ancestors).add(value);
  return Array.isArray(value) ? value.map((item) => checklistValue(item, next))
    : Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, checklistValue(item, next)]));
}

/** Content identities survive list reordering and language changes; changed requirements start unchecked. */
function attachChecklistKeys(node: OpportunityContextNode, value: unknown, path: string, arrayItem = false) {
  if (Array.isArray(value)) {
    for (const child of node.children || []) attachChecklistKeys(child, value[Number(child.id.split('.').at(-1))], path, true);
  } else if (isRecord(value) && !arrayItem && !['name', 'title', 'label', 'document', 'requirement'].some((key) => typeof value[key] === 'string')) {
    for (const child of node.children || []) {
      const key = child.id.slice(node.id.length + 1);
      attachChecklistKeys(child, value[key], `${path}.${key}`);
    }
  } else {
    node.checklistKey = `${path}:${JSON.stringify(checklistValue(value))}`;
  }
}

export function checklistKeys(nodes: OpportunityContextNode[]): string[] {
  return [...new Set(nodes.flatMap((node) => node.checklistKey ? [node.checklistKey] : checklistKeys(node.children || [])))];
}

/** One destination per source, with all of its evidence and contact context retained. */
function consolidateSourceLinks(items: OpportunityContextNode[], lang: string): OpportunityContextNode[] {
  const sources = new Map<string, OpportunityContextNode>();
  const genericLabels = new Set(['url', 'href', 'links', 'sources', 'source_url', 'contacts', 'email', 'contact_email']
    .map((key) => opportunityFieldLabel(key, lang)));
  const hasLink = (node: OpportunityContextNode): boolean => Boolean(node.href || node.children?.some(hasLink));
  const signature = (node: OpportunityContextNode): string => JSON.stringify(node, (key, value) => key === 'id' ? undefined : value);
  function mergeDetails(existing: OpportunityContextNode[], incoming: OpportunityContextNode[]): OpportunityContextNode[] {
    const result = [...existing];
    for (const node of incoming) {
      if (result.some((candidate) => signature(candidate) === signature(node))) continue;
      const index = result.findIndex((candidate) => candidate.label === node.label && node.label !== null
        && candidate.children && node.children && !candidate.href && !node.href);
      if (index >= 0) result[index] = { ...result[index], children: mergeDetails(result[index].children!, node.children!) };
      else result.push(node);
    }
    return result;
  }
  function labelsFor(node: OpportunityContextNode, parents: string[]): string[] {
    const label = node.label?.replace(/ \((?:additional detail|ergänzende Angaben)\)$/, '');
    return label && !genericLabels.has(label) ? [...new Set([...parents, label])] : parents;
  }
  const sourceLabels = new Map<string, string[]>();
  function register(node: OpportunityContextNode, labels: string[], details: OpportunityContextNode[]) {
    const href = node.href!; // Already validated by safeHref; never turn raw values into links here.
    const previous = sources.get(href);
    const allLabels = [...new Set([...(sourceLabels.get(href) || []), ...labels])];
    sourceLabels.set(href, allLabels);
    const children = mergeDetails(previous?.children || [], details);
    sources.set(href, {
      id: previous?.id || `links.destination.${sources.size}`, label: allLabels.join(' · ') || phrase('Source', 'Quelle', lang),
      href, text: previous?.text || node.text, ...(children.length ? { children } : {}),
    });
  }
  function visit(node: OpportunityContextNode, parents: string[] = []): OpportunityContextNode | null {
    const labels = labelsFor(node, parents);
    if (node.href) { register(node, labels, node.children || []); return null; }
    if (!node.children) return node;
    const directLinks = node.children.filter((child) => child.href);
    if (directLinks.length) {
      const details = node.children.filter((child) => !hasLink(child));
      directLinks.forEach((child) => register(child, labelsFor(child, labels), details));
      const remainder = node.children.filter((child) => !child.href && hasLink(child))
        .map((child) => visit(child, labels)).filter((child): child is OpportunityContextNode => child !== null);
      return remainder.length ? { ...node, children: remainder } : null;
    }
    const children = node.children.map((child) => visit(child, labels)).filter((child): child is OpportunityContextNode => child !== null);
    return children.length ? { ...node, children } : null;
  }
  const unlinked = items.map((node) => visit(node)).filter((node): node is OpportunityContextNode => node !== null);
  return [...sources.values(), ...unlinked];
}

/** Keep arbitrary research JSON readable without presenting serialized implementation data. */
export function buildOpportunityGroups(context: Record<string, unknown>, lang: string): OpportunityContextGroup[] {
  const groups = GROUPS.map(([id, en, de]) => ({ id, label: phrase(en, de, lang), items: [] as OpportunityContextNode[] }));
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  const seen = new Map<string, string[]>();
  const primaryLinks = new Map<string, string>();
  const visitedWrappers = new Set<object>();
  const add = (rawKey: string, value: unknown, source: string) => {
    const key = keyName(rawKey);
    if (PRIVATE_KEYS.has(key) || key === 'title') return;
    if ((key === 'data' || key === 'details') && isRecord(value)) {
      if (visitedWrappers.has(value)) return;
      visitedWrappers.add(value);
      Object.entries(value).forEach(([nestedKey, nestedValue]) => add(nestedKey, nestedValue, `${source}.${key}`));
      return;
    }
    const node = buildNode(value, key, `${source}.${rawKey}`, lang, new Set(), opportunityFieldLabel(rawKey, lang));
    if (!node) return;
    if (PRIMARY_LINK_FIELDS.includes(key) && node.href?.startsWith('http') && (source === 'root' || !primaryLinks.has(key))) {
      primaryLinks.set(key, node.href);
    }
    if (SUMMARY_FIELDS.has(key)) node.kind = 'summary';
    if (FIT_FIELDS.has(key)) {
      node.kind = 'fit';
      const score = fitScore(value);
      if (score !== undefined) {
        node.score = score;
        node.text = `${humanText(score, 'score', lang)} / 10`;
        // Keep the rationale while avoiding a second, unformatted copy of the score.
        node.children = node.children?.filter((child) => child.id !== `${node.id}.score`);
      }
    }
    const canonicalKey = ALIASES[key] || key;
    const signature = JSON.stringify(node, (name, item) => name === 'id' ? undefined : item);
    const previous = seen.get(canonicalKey) || [];
    if (previous.includes(signature)) return;
    if (previous.length) node.label += phrase(' (additional detail)', ' (ergänzende Angaben)', lang);
    seen.set(canonicalKey, [...previous, signature]);
    const group = fieldGroup(key);
    if (group === 'requirements' || group === 'documents') attachChecklistKeys(node, value, `${group}:${canonicalKey}`);
    byGroup.get(group)!.items.push(node);
  };
  // Put the two advisor context sections first and surface absent research explicitly.
  for (const [key, en, de] of [
    ['supervisor_research_focus', 'Advisor research focus not recorded.', 'Forschungsschwerpunkte der Betreuung nicht erfasst.'],
    ['supervisor_top_papers', 'Representative papers not recorded.', 'Repräsentative Publikationen nicht erfasst.'],
  ]) {
    const candidates = [context[key], isRecord(context.data) ? context.data[key] : undefined];
    const value = candidates.find((candidate) => buildNode(candidate, key, `root.${key}`, lang, new Set(), opportunityFieldLabel(key, lang)));
    const node = buildNode(value, key, `root.${key}`, lang, new Set(), opportunityFieldLabel(key, lang));
    if (node) add(key, value, 'root');
    else byGroup.get('advisor')!.items.push({ id: `root.${key}`, label: opportunityFieldLabel(key, lang), text: phrase(en, de, lang), missing: true });
  }
  Object.entries(context).forEach(([key, value]) => add(key, value, 'root'));
  const links = byGroup.get('links')!;
  links.items = consolidateSourceLinks(links.items, lang);
  const primaryHref = PRIMARY_LINK_FIELDS.map((key) => primaryLinks.get(key)).find(Boolean);
  const primaryLink = primaryHref ? links.items.find((node) => node.href === primaryHref) : undefined;
  const overview = byGroup.get('overview')!;
  if (primaryLink) {
    overview.items.push({ ...primaryLink, kind: 'main-link' });
    links.items = links.items.filter((node) => node !== primaryLink);
  }
  // Stable reading order, independent of the database column order or JSON wrappers.
  const priority = (node: OpportunityContextNode) => node.kind === 'summary' ? 0 : node.kind === 'main-link' ? 1
    : node.kind === 'fit' ? 2 + [...FIT_FIELDS].indexOf(keyName(node.id.split('.').at(-1)!)) / 10 : 3;
  overview.items.sort((a, b) => priority(a) - priority(b));
  return groups.filter((group) => group.items.length);
}

function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([`*_[\]])/g, '\\$1').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^(\s*)([#>+\-])(?=\s)/gm, '$1\\$2');
}

function nodeMarkdown(node: OpportunityContextNode, depth = 0, completed?: Set<string>): string {
  const indentation = '  '.repeat(depth);
  const label = node.label ? `**${escapeMarkdown(node.label)}:**` : '';
  const text = node.text ? escapeMarkdown(node.text) : '';
  const value = node.href ? `[${text}](<${node.href}>)` : text;
  const checkbox = completed && node.checklistKey ? `[${completed.has(node.checklistKey) ? 'x' : ' '}] ` : '';
  const line = `${indentation}- ${checkbox}${[label, value].filter(Boolean).join(' ')}`;
  return [line.replace(/\n/g, `\n${indentation}  `), ...(node.children || []).map((child) => nodeMarkdown(child, depth + 1, completed))].join('\n');
}

/** Human-readable context suitable for copy/download; contains no raw JSON or executable HTML. */
export function opportunityContextMarkdown(context: Record<string, unknown>, lang: string, completedKeys?: string[]): string {
  const title = typeof context.title === 'string' && context.title.trim() ? context.title.trim()
    : phrase('Opportunity context', 'Kontext zur Stelle', lang);
  const completed = completedKeys ? new Set(completedKeys) : undefined;
  return [`# ${escapeMarkdown(title)}`, ...buildOpportunityGroups(context, lang).map((group) =>
    `## ${group.label}\n\n${group.items.map((item) => nodeMarkdown(item, 0, completed)).join('\n')}`)].join('\n\n');
}
