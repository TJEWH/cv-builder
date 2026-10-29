import { test } from 'node:test';
import { file, reset, sql } from './db';

test('AF-02 owner-scoped approval, consent, private drafts and exact invalidation', () => {
  reset();
  sql(file('../../supabase/opportunity_feedback_signals.sql'));
  sql(file('../../supabase/opportunity_feedback_sharing.sql'));
  sql(file('../../supabase/tests/opportunity_feedback_sharing.sql'));
});
