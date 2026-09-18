/** Shared state contracts for the editor, saved configurations and previews. */
export type ItemState = 'planned' | 'ongoing' | 'complete';
export type SaveStatus = 'saving' | 'saved' | 'error';
export type ContentArea = 'body' | 'sidebar';
export type CustomBodyField = 'title' | 'institution' | 'place' | 'start' | 'end' | 'state' | 'desc';
export interface CvItem {
  id: string;
  hidden?: boolean;
  name?: string;
  title?: string;
  company?: string;
  institution?: string;
  sub?: string;
  place?: string;
  start?: string;
  end?: string;
  state?: ItemState;
  bullets?: string;
  desc?: string;
  thesis?: string;
  coursesText?: string;
  level?: string;
  levelValue?: number;
}
export interface CustomSection {
  id: string;
  name: string;
  entryMode?: 'fields' | 'textarea';
  text?: string;
  fields?: CustomBodyField[];
  entries: CvItem[];
}
export interface SidebarSection {
  id: string;
  name: string;
  levelType: 'experience' | 'years' | null;
  items: CvItem[];
}
export interface Contact {
  name: string;
  location: string;
  role: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  github: string;
}
export interface CvDesign {
  h1?: string; h2?: string; h3?: string; bullets?: string;
  ink?: string; graphicOpacity?: number; dateOpacity?: number;
  fontBody?: string; fontHead?: string; hstyle?: string;
  badgeMode?: string; badgeBorderWidth?: string; badgeBorderRadius?: string;
  sectionSpacing?: string; sectionSpacingBody?: string; sectionSpacingSidebar?: string; itemSpacing?: string;
  sidebarWidth?: string; sidebarAlign?: string; sidebarFillMode?: string; sidebarHeightMode?: string;
  sidebarBottomPadding?: string; headerLayoutStyle?: string; sidebarLayoutStyle?: string;
  contactLayout?: string; separatorWidth?: string;
  pageMarginTop?: string; pageMarginRight?: string; pageMarginBottom?: string; pageMarginLeft?: string;
  pageMarginHorizontalLinked?: boolean; pageMarginVerticalLinked?: boolean;
  headerPaddingBottom?: string; headerBottomMargin?: string; headerBottomSpacingLinked?: boolean;
  bodySidebarSpacing?: string; favoriteControls?: string[];
}
export interface CvState {
  version: number;
  lang: string;
  disabled: string[];
  completedSections: string[];
  keepTogetherSections: string[];
  design: CvDesign;
  anonymization: { excludedSections: string[]; excludedItems: string[] };
  contact: Contact;
  about: { text: string };
  education: CvItem[];
  experience: { jobs: CvItem[] };
  languages: CvItem[];
  hobbies: CvItem[];
  customSections: CustomSection[];
  sidebarSections: SidebarSection[];
  sectionNames: Record<string, string>;
  sectionHeaderSizes: Record<string, string>;
  bodyOrder: string[];
  sidebarOrder: string[];
}
export interface SavedConfiguration { id: string; name: string; mtime?: number }
/** Earlier backups are normalized at the persistence boundary. */
export interface LegacyItem extends Omit<CvItem, 'id' | 'state'> {
  id?: string;
  state?: string;
  tools?: unknown;
  year?: string;
  thesisTopic?: string;
  thesisBullets?: unknown;
  courses?: unknown;
}
export type LegacyCvState = Omit<Partial<CvState>, 'experience' | 'education' | 'hobbies' | 'design' | 'contact' | 'customSections' | 'sidebarSections'> & {
  contact?: Partial<Contact>;
  education?: LegacyItem[];
  hobbies?: LegacyItem[] | Record<string, string>;
  experience?: { jobs?: LegacyItem[]; addExp?: LegacyItem[]; projects?: LegacyItem[] };
  customSections?: (Omit<Partial<CustomSection>, 'entries' | 'fields'> & { entries?: LegacyItem[]; fields?: string[] })[];
  sidebarSections?: Partial<SidebarSection>[];
  design?: CvDesign & { addExpColumns?: unknown };
  custom?: LegacyItem[];
  certs?: LegacyItem[];
  skills?: unknown;
  orderMain?: string[];
  orderSide?: string[];
  sectionPlacement?: unknown;
};

export interface ItemField {
  key: keyof CvItem; label: string; type: string; placeholder?: string;
  options?: (string | Record<string, string>)[];
  optionLabel?: string; optionValue?: string;
}
