<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useSupabaseAuth } from '../composables/useSupabaseAuth';

const props = defineProps<{ lang: 'de' | 'en' }>();
const { user, ready, busy, error, configuration, signIn, signOut, clearError } = useSupabaseAuth();
const panel = ref<HTMLDetailsElement | null>(null);
const email = ref('');
const password = ref('');
const id = useId();
const copy = computed(() => props.lang === 'de' ? {
  login: 'Anmelden', account: 'Supabase-Konto', local: 'Lokal', checking: 'Sitzung prüfen …',
  title: 'Bei Supabase anmelden', email: 'E-Mail', password: 'Passwort', working: 'Bitte warten …',
  logout: 'Abmelden', close: 'Schließen',
  help: 'Melde dich mit deinem bestehenden Konto an, um Stellenangebote und Bewerbungen zu verwalten.',
  privacy: 'Deine CV-Versionen bleiben lokal. Nur ausdrücklich zugewiesene Datenschutz-Versionen werden hochgeladen.',
  session: 'Die Anmeldung wird nur für diese Browser-Sitzung gespeichert.',
  missing: 'Supabase ist nicht eingerichtet. Der CV-Editor ist vollständig lokal nutzbar.',
  invalid: 'Die Supabase-Konfiguration ist ungültig. Der CV-Editor ist weiterhin lokal nutzbar.',
  signInFailed: 'Anmeldung fehlgeschlagen. Prüfe E-Mail, Passwort und Verbindung.',
  signOutFailed: 'Abmeldung fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.',
  sessionFailed: 'Die Sitzung konnte nicht bestätigt werden. Bitte melde dich erneut an.',
} : {
  login: 'Sign in', account: 'Supabase account', local: 'Local', checking: 'Checking session …',
  title: 'Sign in to Supabase', email: 'Email', password: 'Password', working: 'Please wait …',
  logout: 'Sign out', close: 'Close',
  help: 'Use your existing account to manage job opportunities and applications.',
  privacy: 'Your CV versions stay local. Only privacy versions you explicitly assign are uploaded.',
  session: 'Sign-in is saved only for this browser session.',
  missing: 'Supabase is not configured. The CV editor is fully available locally.',
  invalid: 'Supabase configuration is invalid. The CV editor remains available locally.',
  signInFailed: 'Sign-in failed. Check your email, password, and connection.',
  signOutFailed: 'Sign-out failed. Check your connection and try again.',
  sessionFailed: 'Your session could not be verified. Please sign in again.',
});

function close() {
  if (panel.value) panel.value.open = false;
  password.value = '';
}

function onToggle() {
  if (!panel.value?.open) password.value = '';
}

async function submit() {
  // Credentials are passed directly to Auth and removed from component state immediately.
  const attempt = signIn(email.value, password.value);
  password.value = '';
  if (await attempt) close();
}

async function logout() {
  password.value = '';
  if (await signOut()) close();
}

watch(user, (value) => { if (value) { email.value = ''; password.value = ''; } });
onBeforeUnmount(() => { password.value = ''; });
</script>

<template>
  <details ref="panel" class="supabase-auth" @toggle="onToggle" @keydown.esc="close">
    <summary :title="user?.email || copy.account">
      <span class="supabase-auth__dot" :class="{ 'is-connected': user }" aria-hidden="true"></span>
      <span>{{ user ? copy.account : configuration.status === 'ready' ? copy.login : copy.local }}</span>
    </summary>
    <section class="supabase-auth__panel" :aria-labelledby="`${id}-title`">
      <div class="supabase-auth__heading">
        <h2 :id="`${id}-title`">{{ user ? copy.account : copy.title }}</h2>
        <button type="button" class="supabase-auth__close" :aria-label="copy.close" @click="close">×</button>
      </div>
      <p v-if="configuration.status !== 'ready'" role="status">{{ copy[configuration.status] }}</p>
      <template v-else>
        <template v-if="user">
          <p class="supabase-auth__email">{{ user.email }}</p>
          <button type="button" class="btn" :disabled="busy" @click="logout">{{ busy ? copy.working : copy.logout }}</button>
        </template>
        <p v-else-if="!ready" role="status">{{ copy.checking }}</p>
        <form v-else class="supabase-auth__form" @submit.prevent="submit">
          <p>{{ copy.help }}</p>
          <label :for="`${id}-email`">{{ copy.email }}</label>
          <input :id="`${id}-email`" v-model="email" type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required :disabled="busy" @input="clearError" />
          <label :for="`${id}-password`">{{ copy.password }}</label>
          <input :id="`${id}-password`" v-model="password" type="password" name="password" autocomplete="current-password" required :disabled="busy" @input="clearError" />
          <button type="submit" class="btn btn--success" :disabled="busy || !email.trim() || !password">{{ busy ? copy.working : copy.login }}</button>
        </form>
        <p v-if="error" class="supabase-auth__error" role="alert">{{ copy[error] }}</p>
        <p class="supabase-auth__hint">{{ copy.session }}</p>
        <p class="supabase-auth__hint">{{ copy.privacy }}</p>
      </template>
    </section>
  </details>
</template>

<style scoped>
.supabase-auth { position: relative; font-size: 12px; }
.supabase-auth summary { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 11px; border: 1px solid #246153; border-radius: 8px; color: #d1fae5; background: #0a1c26; cursor: pointer; list-style: none; white-space: nowrap; }
.supabase-auth summary::-webkit-details-marker { display: none; }
.supabase-auth summary:focus-visible, .supabase-auth__close:focus-visible { outline: 2px solid #9be8c7; outline-offset: 3px; }
.supabase-auth__dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #8ba39d; }
.supabase-auth__dot.is-connected { background: #27f3a2; box-shadow: 0 0 8px #27f3a240; }
.supabase-auth__panel { position: absolute; z-index: 60; top: calc(100% + 8px); right: 0; display: grid; gap: 12px; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 160px); overflow-y: auto; overscroll-behavior: contain; padding: 18px; border: 1px solid #246153; border-radius: 12px; background: #091c24; box-shadow: 0 16px 48px #0008; color: #d1fae5; scrollbar-width: thin; }
.supabase-auth__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.supabase-auth__heading h2 { margin: 0; font-size: 16px; color: #d1fae5; }
.supabase-auth__close { padding: 0 5px; border: 0; background: none; color: #9bb6b0; font-size: 24px; cursor: pointer; }
.supabase-auth__panel p { margin: 0; line-height: 1.5; }
.supabase-auth__form { display: grid; gap: 9px; }
.supabase-auth__form label { margin-top: 4px; color: #9be8c7; }
.supabase-auth__form input { width: 100%; min-width: 0; }
.supabase-auth__form .btn { margin-top: 5px; }
.supabase-auth__email { overflow-wrap: anywhere; }
.supabase-auth__panel .supabase-auth__hint { color: #91aaa5; font-size: 11px; }
.supabase-auth__panel .supabase-auth__error { color: #fca5a5; }
.supabase-auth .btn:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 760px), (max-height: 520px) {
  .supabase-auth__panel { position: fixed; top: 70px; right: max(16px, env(safe-area-inset-right, 0px)); max-height: calc(100dvh - 90px); }
}
</style>
