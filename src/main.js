import { createApp } from 'vue';
import App from './App.vue';
import './assets/cv.css';

// FontAwesome setup
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
// icons used in the app (solid)
import {
  faIdBadge,
  faInfoCircle,
  faBriefcase,
  faUser,
  faGraduationCap,
  faFolderOpen,
  faTools,
  faLanguage,
  faCertificate,
  faHeart,
  faPlusCircle,
  faHandsHelping,
  faPalette,
  faSave
} from '@fortawesome/free-solid-svg-icons';

library.add(
  faIdBadge, faInfoCircle, faBriefcase, faUser, faGraduationCap,
  faFolderOpen, faTools, faLanguage, faCertificate, faHeart, faPlusCircle, faHandsHelping,
  faPalette, faSave
);

const app = createApp(App);
app.component('font-awesome-icon', FontAwesomeIcon);

app.mount('#app');
