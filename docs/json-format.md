# Content and configuration JSON

The Versions panel has separate export and import actions for content and configuration.
Export the content file, edit its `data` object in another editor or context, then use
**Import content** to replace editable content in the selected CV version. Its version name,
design and other settings remain in place. Public entries absent from the file are removed.
Importing into the empty template opens an editable draft.

**Bypass privacy proxy** is off by default and applies to both content export and import.
With it off, exports replace header/contact values with anonymous examples and omit hidden
or privacy-excluded sections and entries. Paired `!!private text!!` markers become the
static `!!confidential text!!` placeholder. Private Markdown link labels lose their link
destination as well. Content imports preserve the current version's real header/contact,
protected sections, and protected entries, even if absent or changed in the file. Keep IDs
stable so those entries can be identified. If a public section containing a private entry
is removed from the file, its container is retained for that private entry.

Textarea redaction cannot reliably be reversed after external editing. Imported text is
always used literally, including `!!confidential text!!`: it replaces the old textarea
value and does not restore the original secret words. This applies with bypass either on
or off; a wholly protected section or entry still remains untouched when bypass is off.

With bypass enabled, exports contain all original content, including header/contact fields,
hidden sections/entries and original inline markers. Imports can overwrite all those fields.
The checkbox resets to off when switching versions and never changes configuration imports.

**Import configuration** replaces design and settings while retaining the CV's text,
entries and custom sections. Each action accepts only its matching format. Invalid files
leave the document unchanged. The old `cv-builder/cv` format, raw state objects, and
browser-storage wrappers are not supported as imports. There is no combined export.

Filenames use the selected version title, for example `engineering-2026-content-v7.json`
and `engineering-2026-config-v7.json`. Unsaved drafts use the `cv-backup` prefix.

## Content file

A minimal valid content file is:

```json
{
  "format": "cv-builder/content",
  "formatVersion": 1,
  "cvVersion": 7,
  "exportedAt": "2026-09-19T12:00:00.000Z",
  "data": {
    "contact": {
      "name": "Alex Example",
      "location": "",
      "role": "Software Engineer",
      "email": "",
      "phone": "",
      "website": "",
      "linkedin": "",
      "github": ""
    },
    "about": { "text": "Your updated introduction." },
    "education": [],
    "experience": { "jobs": [] },
    "languages": [],
    "hobbies": [],
    "customSections": [],
    "sidebarSections": [],
    "sectionNames": {}
  }
}
```

Keep the wrapper, required properties, and JSON types intact. Empty strings and arrays
are valid. Design, language, layout, visibility, completion and anonymization settings
do not belong in this file. Unknown fields are rejected instead of silently ignored.

Each entry has a required nonempty `id`. Optional text properties are `name`, `title`,
`company`, `institution`, `sub`, `place`, `start`, `end`, `bullets`, `desc`, `thesis`,
`coursesText` and `level`. `state` may be `planned`, `ongoing` or `complete`;
`levelValue` is a finite number. Not every entry type displays every property.

Custom body sections have `id`, `name`, and `entries`; optional `entryMode` is `fields`
or `textarea`, `text` contains textarea content, and `fields` lists enabled content
fields (`title`, `institution`, `place`, `start`, `end`, `state`, `desc`). Sidebar
sections have `id`, `name`, `levelType` (`experience`, `years`, or `null`) and `items`.
`sectionNames` maps section IDs to custom labels.

Keep IDs stable when editing existing items or sections: layout, visibility and
privacy settings refer to those IDs. Give new entries unique IDs. Custom section IDs
must be unique and cannot use the built-in IDs `header`, `about`, `education`, `jobs`,
`languages`, or `hobbies`. Item IDs must be unique across the document and different
from section IDs. New sections are added to the layout automatically; settings tied
to removed IDs may be discarded when the document is normalized.

Unsafe web/email values remain text rather than active links. Unmarked public content is
retained in privacy-respecting exports; the checkbox does not automatically identify PII.

## Configuration file

Configuration files use the same wrapper with `"format": "cv-builder/config"`.
Their `data` object contains exactly:

| Property | Meaning |
| --- | --- |
| `lang` | App language, `de` or `en` |
| `design` | Typography, fonts, colors, spacing and other design controls |
| `disabled` | Hidden section IDs |
| `completedSections` | Completed/locked section IDs |
| `keepTogetherSections` | Sections kept together during pagination |
| `anonymization` | `excludedSections` and `excludedItems` ID arrays |
| `sectionHeaderSizes` | Section ID to heading-size setting |
| `bodyOrder`, `sidebarOrder` | Section ordering |
| `hiddenItems` | Hidden item IDs |

Configuration files do not include contacts, CV text or entry contents. Section/item
IDs can still carry user-chosen labels. Applying configuration to different content
preserves the content, with ID-specific settings applying where IDs match. Unspecified
design properties use the app defaults rather than retaining the previous design.

Both files are unencrypted JSON, limited to 5 MiB per import. For a complete backup,
enable bypass when exporting content and export configuration too. To restore everything,
enable bypass when importing content, then import configuration.
