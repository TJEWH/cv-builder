# CV Builder – Vue.js

Modern resume generator built with Vue 3 and Vite. Create professional CVs with real-time preview and PDF export.

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Tech Stack](#-tech-stack)
- [Development](#-development)

---

## ✨ Features

### Content
- **Personal Information**: Name, role, contact details (email, phone, website, LinkedIn)
- **Sections**: About me, education, work experience, additional experience, projects
- **Skills**: Categorized with level display (bars, dots, stars, percent) or as badges
- **Soft Skills**: With references to jobs
- **Additional**: Languages, hobbies, certificates
- **Custom Sections**: Create your own sections with freely definable fields

### Design
- **Layouts**: Sidebar left/right/none, adjustable column ratio
- **Colors**: Full control over all colors (text, accent, backgrounds)
- **Fonts**: Google Fonts integration (8 body fonts, 8 heading fonts)
- **Typography**: H1-H3 sizes, bullet style individually adjustable
- **Header Styles**: clean, underline, leftbar, pill, stripe
- **Badges**: Border, radius, inverted, box-shadow
- **Spacing**: Individual spacing for body and sidebar

### Workflow
- **Live Preview**: Floating preview (scalable, draggable) + separate preview page
- **Auto-Save**: Automatic saving with status indicator
- **Backup System**: 
  - Browser backup (LocalStorage)
  - Project file backup (JSON in dev mode)
  - Multiple named configurations
  - Import/Export
- **Cross-Tab Sync**: Changes synchronized across browser tabs
- **Multilingual**: German/English (UI + content)
- **Drag & Drop**: Reorder sections and entries

### Export
- **PDF Export**: High-quality with html2pdf.js (A4, 3x scaling)
- **Page-Break Control**: Intelligent page breaks
- **GDPR Compliant**: No cloud, all data local

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

App runs at `http://localhost:5173`



---

## 🎯 Usage

### Basics
- Fill sections with `+` button, remove with `×`
- Eye icon (👁️) shows/hides sections
- Drag & drop to reorder sections and entries
- Auto-save saves all changes automatically

### Customize Design
- Design panel (palette icon) for layout, colors, fonts
- Sidebar position (left/right/none) selectable
- Header styles: clean, underline, leftbar, pill, stripe
- All colors and typography individually adjustable

### Skills
- Categories with optional level types (bars, dots, stars, percent)
- Without level = simple badge list
- Slider for level rating

### Soft Skills
- Label, description + references to jobs
- Link with work experience

### Backup & Export
- **BackupManager** (☰): Multiple named configurations
- Browser mode (LocalStorage) or project file mode (JSON in `/public/cv-backups`)
- **PDF Export**: Open preview → "Export as PDF"
- Import/export JSON files possible







## 🛠 Tech Stack

- **Vue 3.5** + **Vite 7.2**: Framework & build tool
- **html2pdf.js**: PDF export (html2canvas + jsPDF)
- **FontAwesome 7**: Icon system
- **Google Fonts**: Dynamic font loading
- **LocalStorage + IndexedDB**: Persistent storage
- **BroadcastChannel**: Cross-tab sync

---

## 👨‍💻 Development

### Scripts

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Test build
```

### Extend Project

**New Section**: Extend state in `App.vue` → adjust FormBuilder + Preview → translations in `dict.ts`

**Design Option**: State → DesignPanel input → CSS variable in `applyCSS()` → use CSS

**New Skill Level**: Template in `SkillItem.vue` + dropdown in `SkillCategory.vue`

### Debugging

- **Vue DevTools**: Browser extension for component tree and state
- **Console**: `localStorage.getItem('cv-session')` for saved data
- **Backup API**: `curl http://localhost:5173/__backup/list` (dev mode)

---

## 🚀 Deployment

### GitHub Pages (Configured ✅)

This project is configured for automatic deployment to GitHub Pages:

1. **Push to `main` branch** → Automatic build & deploy via GitHub Actions
2. **Configure GitHub Settings**: Go to Settings → Pages → Source: "GitHub Actions"
3. **Access**: `https://tjewh.github.io/cv-builder/`

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup instructions.

### Manual Deployment

Create build: `npm run build` → `/dist` folder

**Other Static Hosting** (Netlify, Vercel, Cloudflare Pages):
- Build Command: `npm run build`
- Output: `dist`

**Subfolder Deployment**: Already configured with `base: '/cv-builder/'` in `vite.config.js`

---

## 📝 Notes

- **Browser**: Chrome/Edge/Firefox/Safari (latest versions)
- **Privacy**: No cloud, no tracking, 100% local
- **Performance**: PDF export may be slow for very large CVs

---

**Good luck! 🎉**


