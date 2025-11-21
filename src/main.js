import { createApp } from 'vue';
import App from './App.vue';
import './assets/cv.css';

// FontAwesome setup
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
// Import ALL solid icons
import { fas } from '@fortawesome/free-solid-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

// Add all solid icons and brands to the library
library.add(fas, fab);

const app = createApp(App);
app.component('font-awesome-icon', FontAwesomeIcon);

app.mount('#app');