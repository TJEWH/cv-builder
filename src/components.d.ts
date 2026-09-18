import type InputText from 'primevue/inputtext';
import type InputNumber from 'primevue/inputnumber';
import type Select from 'primevue/select';
import type Textarea from 'primevue/textarea';
import type { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

declare module 'vue' {
  export interface GlobalComponents {
    InputText: typeof InputText;
    InputNumber: typeof InputNumber;
    Select: typeof Select;
    Textarea: typeof Textarea;
    FontAwesomeIcon: typeof FontAwesomeIcon;
  }
}
export {};
