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
- **Sidebar Categories**: Add custom sidebar sections with badge, experience, or years-based skill displays
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
- **Live Preview**: Inline live preview with a full-size in-app preview mode
- **Auto-Save**: Automatic saving with status indicator
- **Backup System**:
  - Browser-local persistence (LocalStorage)
  - Multiple named configurations
  - Import/Export
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
- Use the right-side section handle to open the fixed Body/Sidebar reorder dialog
- Use item handles to drag entries and sidebar skills directly
- Auto-save saves all changes automatically

### Customize Design
- Design panel (palette icon) for layout, colors, fonts
- Sidebar position (left/right/none) selectable
- Header styles: clean, underline, leftbar, pill, stripe
- All colors and typography individually adjustable

### Sidebar Categories
- Sidebar-only custom sections use a normal section header and optional skill levels
- Without a level type, skills render as badges

### Soft Skills
- Label, description + references to jobs
- Link with work experience

### Backup & Export
- **BackupManager** (☰): Multiple named configurations
- Browser-local storage (LocalStorage)
- **PDF Export**: Download directly from the builder or full preview mode
- Import/export JSON files possible







## 🛠 Tech Stack

- **Vue 3.5** + **Vite 7.2**: Framework & build tool
- **html2pdf.js**: PDF export (html2canvas + jsPDF)
- **FontAwesome 7**: Icon system
- **VueDraggable**: Handle-based section and item sorting
- **Google Fonts**: Dynamic font loading
- **LocalStorage**: Persistent storage and named browser configurations

---

## 👨‍💻 Development

### Scripts

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Test build
npm test             # Content-state migration tests
```

### Extend Project

**New Section**: Extend state in `App.vue` → adjust FormBuilder + Preview → translations in `dict.ts`

**Design Option**: State → DesignPanel input → CSS variable in `applyCSS()` → use CSS

**Sidebar Skill Display**: Template in `SkillItem.vue` + level configuration in `FormBuilder.vue`

### Debugging

- **Vue DevTools**: Browser extension for component tree and state
- **Console**: `localStorage.getItem('cv-session')` for saved data
- **Saved data**: inspect `localStorage.getItem('cv-session')` in the browser console

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

**Custom Domain Deployment**: This build targets the GitHub Pages project URL at `/cv-builder/`. If you later use a custom domain served from its root, change `base` in `vite.config.js` to `/` and add the domain configuration appropriate to that host.

---

## 📝 Notes

- **Browser**: Chrome/Edge/Firefox/Safari (latest versions)
- **Privacy**: No cloud, no tracking, 100% local
- **Performance**: PDF export may be slow for very large CVs

---

**Good luck! 🎉**
