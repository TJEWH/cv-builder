// Centralized dictionary for language translation (i18n)
export const dict = {
    openPdf:            {de: 'PDF öffnen', en: 'open PDF'},
    showPreview:        {de: 'Vorschau anzeigen', en: 'show preview'},
    hidePreview:        {de: 'Vorschau ausblenden', en: 'hide preview'},

    // Toggles / captions
    storageCaption:     {de: 'Speicherort', en: 'Storage'},
    browser:            {de: 'Browser', en: 'Browser'},
    project:            {de: 'Projekt', en: 'Project'},
    languageCaption:    {de: 'Sprache', en: 'Language'},
    deShort:            {de: 'DE', en: 'DE'},
    enShort:            {de: 'EN', en: 'EN'},
    german:             {de: 'Deutsch', en: 'German'},
    english:            {de: 'Englisch', en: 'English'},

    // Generic buttons / messages
    load:               {de: 'Laden', en: 'Load'},
    save:               {de: 'Speichern', en: 'Save'},
    newSection:         {de: 'Neue Sektion', en: 'New section'},
    addEntry:           {de: 'Eintrag hinzufügen', en: 'Add entry'},
    entryCSV:           {de: 'Einträge (komma-getrennt)', en: 'Entries (comma-separated)'},
    addLanguage:        {de: 'Sprache hinzufügen', en: 'Add language'},
    addCert:            {de: 'Zertifikat hinzufügen', en: 'Add certificate'},
    addSkillType:       {de: 'Gruppe hinzufügen', en: 'Add skill type'},
    show:               {de: 'Einblenden', en: 'Show'},
    hide:               {de: 'Ausblenden', en: 'Hide'},
    remove:             {de: 'Entfernen', en: 'Remove'},

    // Status messages
    loading:            {de: 'Lädt…', en: 'Loading…'},
    editing:            {de: 'Bearbeiten…', en: 'Editing…'},
    saved:              {de: 'Gesichert', en: 'Saved'},
    loadedLast:         {de: 'Letzte Session geladen', en: 'Loaded last session'},
    backupBrowserFallback: {
        de: 'Backup (Browser) geladen (Datei-Modus nicht verfügbar)',
        en: 'Backup (browser) loaded (file mode not available)'
    },
    backupBrowser:      {de: 'Backup-Datei geladen', en: 'Backup file loaded'},
    backupProject:      {de: 'Projekt-Datei geladen', en: 'Project file loaded'},
    defaultLoaded:      {de: 'Standard-Daten geladen', en: 'Default data loaded'},
    defaultFailed:      {de: 'Standard-Daten konnten nicht geladen werden', en: 'Failed to load default data'},
    savedProjectDevSrv: {de: 'Gespeichert im Projekt (Dev-Server).', en: 'Saved to project (dev server).'},
    savedProjectFsApi:  {de: 'Gespeichert im Projekt (FS-API).', en: 'Saved to project (FS-API).'},
    savedBrowserOPFS:   {de: 'Im Browser (OPFS) gespeichert.', en: 'Saved in browser (OPFS).'},
    savedBrowserLs:     {de: 'Im Browser (LocalStorage) gespeichert.', en: 'Saved in browser (LocalStorage).'},
    saveError:          {de: 'Backup fehlgeschlagen', en: 'Backup failed.'},
    backupNotFound:     {de: 'Keine Backup-Datei gefunden', en: 'No backup file found'},

    // Section titles
    headerTitle:     { de:'Kontakt (Header)', en:'Contact (Header)' },
    aboutTitle:      { de:'Selbstbeschreibung', en:'Profile' },
    expJobTitle:     { de:'Berufserfahrung', en:'Professional Experience' },
    expPersonalTitle:{ de:'Persönliche Erfahrung', en:'Personal Experience' },
    educationTitle:  { de:'Ausbildung', en:'Education' },
    projectsTitle:   { de:'Projekte & Publikationen', en:'Projects & Publications' },
    skillsTitle:     { de:'Fähigkeiten', en:'Skills' },
    languagesTitle:  { de:'Sprachen', en:'Languages' },
    certsTitle:      { de:'Zertifikate', en:'Certificates' },
    hobbiesTitle:    { de:'Hobbys', en:'Hobbies' },
    customTitle:     { de:'Eigene Sektionen', en:'Custom Sections' },
    softSkillsTitle: { de:'Soft Skills – Checkliste', en:'Soft Skills – Checklist' },

    // Skill labels
    programmingLang: { de:'Programmiersprachen', en:'Programming Languages' },
    methodologies:   { de:'Methoden & Architektur', en:'Methods & Architecture' },

    // Field labels – Header
    name:           { de:'Name', en:'Name' },
    location:       { de:'Ort', en:'Location' },
    role:           { de:'Rolle', en:'Role' },
    email:          { de:'E-Mail', en:'Email' },
    phone:          { de:'Telefon', en:'Phone' },
    website:        { de:'Website', en:'Website' },
    linkedin:       { de:'LinkedIn', en:'LinkedIn' },

    // About
    aboutTextLabel: { de:'Text', en:'Text' },

    // Experience/Education/Projects common
    position:       { de:'Position', en:'Position' },
    company:        { de:'Unternehmen', en:'Company' },
    place:          { de:'Ort', en:'Place' },
    start:          { de:'Start', en:'Start' },
    end:            { de:'Ende', en:'End' },
    bulletsLabel:   { de:'Aufgaben/Erfolge (eine je Zeile)', en:'Responsibilities/Achievements (one per line)' },
    title:          { de:'Titel', en:'Title' },
    subtitle:       { de:'Untertitel', en:'Subtitle' },
    year:           { de:'Jahr', en:'Year' },
    desc:           { de:'Kurzbeschreibung', en:'Short description' },
    degreeTitle:    { de:'Abschluss/Titel', en:'Degree/Title' },
    institution:    { de:'Institution', en:'Institution' },
    focus:          { de:'Schwerpunkte (optional)', en:'Focus (optional)' },
    projectTitle:   { de:'Titel/Repo', en:'Title/Repo' },

    // Languages
    languageName:   { de:'Sprache', en:'Language' },
    level:          { de:'Niveau',  en:'Level' },
    level_native:   { de:'Muttersprache', en:'Native' },

    // Placeholder
    current:            { de:'heute', en:'current' },
    tasksPH:            { de:'Skalierung von X\nEinführung CI/CD\nMentoring', en:'Scaling X\nIntroduce CI/CD\nMentoring' },
    customSectionPH:    { de:'Konferenzen / Ehrenamt / …', en:'Conferences / Volunteering / …' },
    hackathonTitlePH:   { de:'1. Platz – Team von 4', en:'1st place – team of 4' },
    hackathonDescPH:    { de:'Prototyp einer ML-App, 48h Sprint …', en:'Prototype of an ML app, 48h sprint …' },
    aboutPH:            { de:'Kurzbeschreibung über mich…', en:'Short description about me…' },

    // Skills
    category:       { de:'Kategorie', en:'Category' },
    programmingLanguages:{ de:'Programmiersprachen', en:'Programming Languages' },

    // Certs
    certificate:    { de:'Zertifikat', en:'Certificate' },
    yearShort:      { de:'Jahr', en:'Year' },

    // Hobbies
    hobbyDesc:      { de:'Hobbys - Details', en:'Hobbies - details' },

    // Soft skills checklist items
    analyticThinking:       { de:'Analytisches Denken', en:'Analytic Thinking' },
    adaptability:           { de:'Anpassungsfähigkeit', en:'Adaptability' },
    criticalThinking:       { de:'Kritisches Denken', en:'Critical Thinking' },
    problemSolving:         { de:'Kreative Problemlösung', en:'Creative Problem Solving' },
    communicationSkills:    { de:'Kommunikationsstärke', en:'Communication Skills' },
    emotionalIntelligence:  { de:'Emotionale Intelligenz', en:'Emotional Intelligence' },
    teamwork:               { de:'Teamfähigkeit', en:'Teamwork' },
    digitalCompetence:      { de:'Digitale Kompetenz', en:'Digital Competence' },
    entrepreneurship:       { de:'Entrepreneurship', en:'Entrepreneurship' },

    // Preview section headings (if you want different wording)
    experienceH3Job:        { de:'Berufserfahrung', en:'Professional Experience' },
    experienceH3Personal:   { de:'Persönliche Erfahrung', en:'Personal Experience' },

    // Formatting tokens
    dotSep: { de:' · ', en:' · ' },
    rangeSep:{ de:' – ', en:' – ' },
};

export function makeT(langRef){
    return (key)=> (dict[key]?.[langRef.value] ?? dict[key]?.de ?? key);
}
