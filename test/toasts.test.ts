import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, ref } from 'vue';
import { useToasts, useToastWatch } from '../src/composables/useToasts';

const { toasts, notify, dismiss, pause, resume, clear } = useToasts();

test('notices replace matching keys, refresh expiry and ignore empty messages', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  assert.equal(notify({ message: '  ' }), 0);
  const id = notify({ message: 'Saved', key: 'save', tone: 'success' });
  assert.equal(toasts.value[0].duration, 2000);
  t.mock.timers.tick(700);
  assert.equal(notify({ message: 'Saved again', key: 'save', tone: 'success' }), id);
  assert.equal(toasts.value.length, 1);
  assert.equal(toasts.value[0].message, 'Saved again');
  t.mock.timers.tick(1999);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('reading or focusing a toast pauses its remaining lifetime until all pause reasons end', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  const id = notify({ message: 'Copied' });
  t.mock.timers.tick(400);
  pause(id, 'pointer'); pause(id, 'focus');
  t.mock.timers.tick(5000);
  resume(id, 'pointer');
  t.mock.timers.tick(5000);
  assert.equal(toasts.value.length, 1);
  resume(id, 'focus');
  t.mock.timers.tick(1599);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('errors use the same two-second lifetime, keep retry actions and refresh when repeated', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  let retried = false;
  const id = notify({ message: 'Save failed', tone: 'error', action: { label: 'Retry', run: () => { retried = true; } } });
  t.mock.timers.tick(1500);
  assert.equal(toasts.value.length, 1);
  assert.equal(notify({ message: 'Save failed', tone: 'error', action: toasts.value[0].action }), id);
  toasts.value[0].action!.run();
  assert.ok(retried);
  t.mock.timers.tick(1999);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('a newer toast replaces the previous one immediately and receives its own full lifetime', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  clear(); t.after(clear);
  const old = notify({ message: 'Saved', key: 'save', tone: 'success' });
  t.mock.timers.tick(750);
  const latest = notify({ message: 'Copied', key: 'copy' });
  assert.notEqual(latest, old);
  assert.deepEqual(toasts.value.map(toast => toast.message), ['Copied']);
  dismiss(old);
  t.mock.timers.tick(1250);
  assert.equal(toasts.value[0].id, latest, 'the earlier timer cannot dismiss the replacement');
  t.mock.timers.tick(749);
  assert.equal(toasts.value.length, 1);
  t.mock.timers.tick(1);
  assert.equal(toasts.value.length, 0);
});

test('message watchers announce repeated attempts synchronously and clear resolved errors', t => {
  clear(); t.after(clear);
  const message = ref('');
  const scope = effectScope();
  scope.run(() => useToastWatch(() => message.value, { tone: 'error' }));
  t.after(() => scope.stop());
  message.value = 'Could not save';
  assert.equal(toasts.value[0].message, message.value);
  const first = toasts.value[0].id;
  message.value = '';
  assert.equal(toasts.value.length, 0);
  message.value = 'Could not save';
  assert.notEqual(toasts.value[0].id, first);
  message.value = '';
  assert.equal(toasts.value.length, 0);
});

test('leaving a component invalidates retry actions without losing non-action result notices', t => {
  clear(); t.after(clear);
  const scope = effectScope();
  const error = ref('Could not save');
  const notice = ref('Copied');
  scope.run(() => {
    useToastWatch(() => error.value, { tone: 'error', action: { label: 'Retry', run() {} } });
    useToastWatch(() => notice.value);
  });
  assert.equal(toasts.value.length, 1);
  scope.stop();
  assert.deepEqual(toasts.value.map(toast => toast.message), ['Copied']);
  error.value = 'Another error';
  assert.equal(toasts.value.length, 1);
});
