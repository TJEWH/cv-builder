import { createApp } from 'vue';
import PreviewRoot from './preview/PreviewRoot.vue';
import './assets/cv.css';

// FontAwesome setup
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

library.add(fas, fab);

const previewEl = document.querySelector('#preview');
if (previewEl) {
  const app = createApp(PreviewRoot);
  app.component('font-awesome-icon', FontAwesomeIcon);
  app.mount('#preview');
}
