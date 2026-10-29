-- AF-03: management-only outgoing allowlist. No raw private explanation,
-- application context, documents, people arrays or arbitrary research JSON.
-- Prerequisites: opportunity_feedback_signals.sql, opportunity_feedback_sharing.sql.
begin;

-- Decode bounded nested percent-encoding for inspection only; preserve the
-- original public URL's case-sensitive path and vacancy identifiers in output.
create function private.opportunity_feedback_url_decoded(p_text text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare current_text text:=p_text; next_text text; bytes bytea; piece text; index integer; pass integer;
begin
  if p_text is null or char_length(p_text)>8192 then return null; end if;
  for pass in 1..3 loop
    if position('%' in current_text)=0 then return current_text; end if;
    bytes:=''::bytea; index:=1;
    while index<=char_length(current_text) loop
      piece:=substr(current_text,index,1);
      if piece='%' then
        piece:=substr(current_text,index+1,2);
        if piece !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
        bytes:=bytes||decode(piece,'hex'); index:=index+3;
      else
        bytes:=bytes||convert_to(piece,'UTF8'); index:=index+1;
      end if;
    end loop;
    next_text:=convert_from(bytes,'UTF8');
    if next_text=current_text then return current_text; end if;
    current_text:=next_text;
  end loop;
  if current_text ~ '%[0-9A-Fa-f]{2}' then return null; end if;
  return current_text;
exception when character_not_in_repertoire or untranslatable_character or invalid_parameter_value then return null;
end;
$$;

create function private.opportunity_feedback_safe_url(p_url text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare parts text[]; authority text[]; scheme text; host text; port integer; path text; query text;
  plain text; component text; pair text; key text; value text;
  private_key text:='(access[[:space:]_-]*token|refresh[[:space:]_-]*token|token|key|api[[:space:]_-]*key|auth(entication|orization)?|password|passwd|pwd|secret|session([[:space:]_-]*id)?|jwt|code|email([[:space:]_-]*address)?|e[[:space:]_-]*mail|phone([[:space:]_-]*number)?|mobile|tel|telephone|address|street|name|first[[:space:]_-]*name|last[[:space:]_-]*name|full[[:space:]_-]*name|user([[:space:]_-]*id|[[:space:]_-]*name)?|candidate([[:space:]_-]*id)?|applicant([[:space:]_-]*id)?|person([[:space:]_-]*id)?|contact([[:space:]_-]*id)?)';
begin
  if p_url is null or char_length(p_url)>2048 or p_url ~ '[[:cntrl:][:space:]]' or position(chr(92) in p_url)>0 then return null; end if;
  parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)([?][^#]*)?(#.*)?$','i');
  if parts is null then return null; end if;
  scheme:=lower(parts[1]);
  authority:=regexp_match(parts[2],'^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]+)?$');
  if authority is null then return null; end if;
  host:=lower(authority[1]);
  if position('.' in host)=0 or host !~ '[.][A-Za-z][A-Za-z0-9-]*$' or host ~ '^[0-9.]+$' or host ~ '[.][.]'
    or host ~ '(^|[.])-|-[.]' or host ~ '[.](localhost|local)$' then return null; end if;
  if authority[3] is not null then
    port:=substr(authority[3],2)::integer;
    if port<0 or port>65535 then return null; end if;
  end if;
  path:=coalesce(nullif(parts[3],''),'/'); query:=coalesce(parts[4],'');
  plain:=private.opportunity_feedback_url_decoded(p_url);
  if plain is null or plain ~ '[[:cntrl:]]' or position(chr(92) in plain)>0
    or plain ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    or plain ~* '(mailto|tel):'
    or plain ~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    or plain ~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)'
    or plain ~* '/(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|authorize|password|reset-password|session)(/|$)'
    or regexp_replace(plain,'[[:space:]_+-]+','','g') ~* ('[?&#]'||private_key||'=')
    or plain ~* 'https?://[^[:space:]/]+@' then return null; end if;
  foreach pair in array string_to_array(substr(query,2),'&') loop
    key:=private.opportunity_feedback_url_decoded(replace(split_part(pair,'=',1),'+',' '));
    value:=private.opportunity_feedback_url_decoded(replace(substr(pair,position('=' in pair)+1),'+',' '));
    if key is null or value is null or regexp_replace(key,'[[:space:]_+-]+','','g') ~* ('^'||private_key||'$') then return null; end if;
  end loop;
  component:=private.opportunity_feedback_url_decoded(coalesce(parts[5],''));
  if component is null then return null; end if;
  return scheme||'://'||host||case when port is not null and not (scheme='http' and port=80 or scheme='https' and port=443)
    then ':'||port::text else '' end||path||query||coalesce(parts[5],'');
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;

-- Strengthen optional public text consistently even on an older AF-02 helper.
create function private.opportunity_feedback_projection_text(p_text text,p_max_length integer) returns boolean
language sql immutable security invoker set search_path='' as $$
  select public.opportunity_feedback_safe_text(p_text,p_max_length)
    and p_text ~ '[^[:space:]]'
    and p_text !~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)';
$$;

-- The compiler checks per-search consent before calling this internal function.
-- Every returned field is built explicitly; nothing serializes an entire row.
create function private.project_opportunity_feedback(p_user_id uuid,p_opportunity_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare public_fact record; review record; metric jsonb; result jsonb; baseline jsonb;
  topic text; reason jsonb; value text; approved_summary text; reasons jsonb:='[]'; topics jsonb:='[]';
  withheld jsonb:=jsonb_build_object('unsafe_text',0,'unsafe_url',0,'topic_limit',0,'unsafe_reason',0,'unapproved_summary',0);
  field text; limit_length integer; counter text;
begin
  if p_user_id is null or p_opportunity_id is null then raise exception 'Feedback requires an owner and opportunity' using errcode='22023'; end if;
  select o.opportunity_key,o.title,o.institution,o.official_url,o.source_url,o.research_summary,o.topics
    into public_fact from public.opportunities o where o.id=p_opportunity_id;
  if not found then return null; end if;
  select r.state,r.interest_reasons,r.feedback_excluded,r.prediction_baseline,
    r.search_feedback_summary,r.search_feedback_revision,r.search_feedback_summary_hash,r.search_feedback_source_hash,
    r.search_feedback_approved_at,r.search_feedback_approved_summary_hash,r.search_feedback_approved_source_hash
    into review from public.opportunity_reviews r where r.user_id=p_user_id and r.opportunity_id=p_opportunity_id;
  if coalesce(review.feedback_excluded,false) then return null; end if;
  metric:=private.opportunity_interest_metric(p_user_id,p_opportunity_id);
  result:=jsonb_build_object('opportunity_id',p_opportunity_id,'topics',topics,
    'metric_version',metric->'metric_version','interest_score',metric->'interest_score','interest_origin',metric->'interest_origin',
    'interest_gap',metric->'interest_gap','baseline_status',metric->'baseline_status',
    'feedback_revision',metric->'feedback_revision','feedback_updated_at',metric->'feedback_updated_at',
    'review_state',coalesce(review.state,'unreviewed'),'confirmed_submission',metric->'confirmed_submission','submission_at',metric->'submission_at');
  if metric->>'baseline_status'='available' then
    baseline:=review.prediction_baseline;
    result:=result||jsonb_build_object('original_prediction',jsonb_build_object('user_id',p_user_id,'opportunity_id',p_opportunity_id,
      'score',baseline->'score','scale_min',0,'scale_max',10,'predicted_at',baseline->>'predicted_at',
      'source_kind','historical_snapshot','source_ref',baseline->>'source_ref'));
  end if;
  foreach field in array array['opportunity_key','title','institution','research_summary'] loop
    value:=case field when 'opportunity_key' then public_fact.opportunity_key when 'title' then public_fact.title
      when 'institution' then public_fact.institution else public_fact.research_summary end;
    limit_length:=case field when 'title' then 240 when 'research_summary' then 1000 else 200 end;
    if value is not null and value<>'' then
      if private.opportunity_feedback_projection_text(value,limit_length) then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_text}',to_jsonb((withheld->>'unsafe_text')::integer+1)); end if;
    end if;
  end loop;
  foreach field in array array['official_url','source_url'] loop
    value:=case field when 'official_url' then public_fact.official_url else public_fact.source_url end;
    if value is not null and value<>'' then
      value:=private.opportunity_feedback_safe_url(value);
      if value is not null then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_url}',to_jsonb((withheld->>'unsafe_url')::integer+1)); end if;
    end if;
  end loop;
  for topic in select distinct t.label collate "C" from unnest(public_fact.topics) t(label) order by t.label collate "C" loop
    counter:=null;
    if not private.opportunity_feedback_projection_text(topic,120) then counter:='unsafe_text';
    elsif jsonb_array_length(topics)>=16 then counter:='topic_limit';
    else topics:=topics||jsonb_build_array(topic); end if;
    if counter is not null then withheld:=jsonb_set(withheld,array[counter],to_jsonb((withheld->>counter)::integer+1)); end if;
  end loop;
  if jsonb_typeof(review.interest_reasons)='array' then
    for reason in select e.value from jsonb_array_elements(review.interest_reasons) e loop
      if jsonb_array_length(reasons)>=16 or jsonb_typeof(reason)<>'object'
        or jsonb_typeof(reason->'category') is distinct from 'string' or jsonb_typeof(reason->'polarity') is distinct from 'string'
        or reason->>'category' not in ('topic','method','hardware','location','funding','timing','other')
        or reason->>'polarity' not in ('positive','negative')
        or reason ? 'target' and (reason->>'category' not in ('topic','method')
          or not private.opportunity_feedback_projection_text(reason->>'target',120)) then
        withheld:=jsonb_set(withheld,'{unsafe_reason}',to_jsonb((withheld->>'unsafe_reason')::integer+1));
      else
        reasons:=reasons||jsonb_build_array(jsonb_build_object('category',reason->>'category','polarity',reason->>'polarity')
          ||case when reason ? 'target' then jsonb_build_object('target',reason->>'target') else '{}'::jsonb end);
      end if;
    end loop;
  end if;
  if review.search_feedback_approved_at is not null
    and private.opportunity_feedback_projection_text(review.search_feedback_summary,600)
    and encode(sha256(convert_to(review.search_feedback_summary,'UTF8')),'hex')=review.search_feedback_summary_hash
    and review.search_feedback_approved_summary_hash=review.search_feedback_summary_hash
    and review.search_feedback_approved_source_hash=review.search_feedback_source_hash
    and exists(select 1 from public.opportunity_feedback_summary_approvals proof where proof.user_id=p_user_id and proof.opportunity_id=p_opportunity_id
      and proof.summary_revision=review.search_feedback_revision and proof.summary_hash=review.search_feedback_summary_hash
      and proof.source_hash=review.search_feedback_source_hash and proof.approved_at=review.search_feedback_approved_at) then
    approved_summary:=review.search_feedback_summary;
    result:=result||jsonb_build_object('search_feedback_summary',approved_summary,'summary_approval',jsonb_build_object(
      'summary_hash',review.search_feedback_summary_hash,'source_hash',review.search_feedback_source_hash,
      'summary_revision',review.search_feedback_revision,'approved_at',review.search_feedback_approved_at));
  elsif review.search_feedback_summary is not null and review.search_feedback_summary<>'' then
    withheld:=jsonb_set(withheld,'{unapproved_summary}','1'::jsonb);
  end if;
  -- Explicitly approved text and structured reasons remain useful without a
  -- numeric rating. Unknown interest stays JSON null, never an implicit zero.
  if metric->'interest_score'='null'::jsonb and jsonb_array_length(reasons)=0 and approved_summary is null then return null; end if;
  return result||jsonb_build_object('topics',topics,'reasons',reasons,'withheld_counts',withheld);
end;
$$;

revoke all on function private.opportunity_feedback_url_decoded(text) from public,anon,authenticated,service_role;
revoke all on function private.opportunity_feedback_safe_url(text) from public,anon,authenticated,service_role;
revoke all on function private.opportunity_feedback_projection_text(text,integer) from public,anon,authenticated,service_role;
revoke all on function private.project_opportunity_feedback(uuid,uuid) from public,anon,authenticated,service_role;
commit;
