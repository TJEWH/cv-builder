/** Isolated UI fixture: no accounts, storage, or network operations. */
import { createApp, h, ref } from 'vue';
import AppToaster from '../../src/components/AppToaster.vue';
import { useToasts } from '../../src/composables/useToasts';
import '../../src/assets/cv.css';

createApp({
  setup() {
    const { notify } = useToasts();
    const dialog = ref<HTMLDialogElement | null>(null);
    const retries = ref(0);
    return () => h('main', { style: 'padding:24px;color:#d1fae5;font-family:system-ui;max-width:750px' }, [
      h(AppToaster),
      h('h1', 'Hints and notifications'),
      h('p', { class: 'app-hint' }, 'Files stay on this device. This guidance stays visible while operation results appear at the top right.'),
      h('button', { class: 'btn', onClick: () => notify({ key: 'fixture-save', message: 'Changes saved.', tone: 'success' }) }, 'Save changes'),
      h('button', { class: 'btn', onClick: () => notify({ message: 'Connection unavailable. Retry when ready.', tone: 'error', action: { label: 'Retry', run: () => { retries.value++; notify({ message: 'Retry succeeded.', tone: 'success' }); } } }) }, 'Simulate failure'),
      h('button', { class: 'btn', onClick: () => dialog.value?.showModal() }, 'Open dialog'),
      h('p', `Completed retries: ${retries.value}`),
      h('dialog', { ref: dialog, style: 'padding:24px;background:#091c24;color:#d1fae5;border:1px solid #28534e' }, [
        h('h2', 'Operation in a dialog'),
        h('p', { class: 'app-hint' }, 'A notification and its retry action remain accessible while this dialog is open.'),
        h('button', { class: 'btn', onClick: () => notify({ message: 'Dialog operation failed.', tone: 'error', action: { label: 'Retry dialog operation', run: () => { retries.value++; notify({ message: 'Dialog operation succeeded.', tone: 'success' }); } } }) }, 'Fail dialog operation'),
        h('button', { class: 'btn', onClick: () => dialog.value?.close() }, 'Close dialog'),
      ]),
    ]);
  },
}).mount('#app');
