import { createApp } from 'vue';
import App from './App.vue';
import PreviewRoot from './preview/PreviewRoot.vue';
import './assets/cv.css';

// FontAwesome setup
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
// Import ALL solid icons
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

// Add all solid icons and brands to the library
library.add(fas, fab);

// Mount main app
const app = createApp(App);
app.component('font-awesome-icon', FontAwesomeIcon);
app.mount('#app');

// Mount preview app if element exists
const previewEl = document.querySelector('#preview');
if (previewEl) {
  const previewApp = createApp(PreviewRoot);
  previewApp.component('font-awesome-icon', FontAwesomeIcon);
  previewApp.mount('#preview');
}