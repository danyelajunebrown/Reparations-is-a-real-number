-- Migration 121: derive_blocking_keys() — SQL port of PersonService._queryKeys
-- Date: 2026-07-06
--
-- WHY: the bulk-lead-ingest path (plan-bulk-ingest-and-enslaved-org.md) writes blocking keys with ONE
-- set-based INSERT instead of ~N per-person round-trips (the ~4h-for-21K Neon bottleneck). To stay
-- byte-identical to the interactive path, the key derivation MUST match `_queryKeys` exactly:
--   sn:<surname>            (norm last name, len>=2)
--   s4:<surname[-4:]>       (len>=4)
--   mp:<metaphone(surname,8)> (len>=2, non-empty)
--   nmsx:<norm(fullname)>:<sex1>
--   nmsxb:<norm(fullname)>:<sex1>:<decade>   (when birth_year present)
-- every key left(,64). key_type = split_part(key,':',1). (Twin of person_role_group() — SQL mirror of JS.)

CREATE OR REPLACE FUNCTION derive_blocking_keys(p_name text, p_sex text, p_birth_year int)
RETURNS TABLE(key_type text, key_value text) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  toks text[];
  last_raw text;
  surname text;
  nm text;
  sx text;
  mp text;
  k text;
  keys text[] := ARRAY[]::text[];
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN; END IF;
  -- _parseName: split on [\s,]+; comma → last = first token; else last = last token (len>1) else ''.
  toks := array_remove(regexp_split_to_array(btrim(p_name), '[[:space:],]+'), '');
  IF position(',' in p_name) > 0 THEN
    last_raw := toks[1];
  ELSIF array_length(toks, 1) > 1 THEN
    last_raw := toks[array_length(toks, 1)];
  ELSE
    last_raw := '';
  END IF;
  surname := regexp_replace(lower(coalesce(last_raw, '')), '[^a-z0-9]', '', 'g');   -- _norm(last)
  nm      := regexp_replace(lower(p_name), '[^a-z0-9]', '', 'g');                    -- _norm(name)
  sx      := CASE lower(left(coalesce(p_sex, ''), 1)) WHEN 'm' THEN 'm' WHEN 'f' THEN 'f' ELSE 'u' END;

  IF length(surname) >= 2 THEN
    keys := keys || ('sn:' || surname);
    IF length(surname) >= 4 THEN keys := keys || ('s4:' || right(surname, 4)); END IF;
    BEGIN
      mp := metaphone(surname, 8);
      IF mp IS NOT NULL AND mp <> '' THEN keys := keys || ('mp:' || mp); END IF;
    EXCEPTION WHEN others THEN NULL;   -- fuzzystrmatch absent → skip mp (matches JS try/catch)
    END;
  END IF;
  IF nm <> '' THEN
    keys := keys || ('nmsx:' || nm || ':' || sx);
    IF p_birth_year IS NOT NULL THEN
      keys := keys || ('nmsxb:' || nm || ':' || sx || ':' || ((p_birth_year / 10) * 10)::text);
    END IF;
  END IF;

  FOREACH k IN ARRAY keys LOOP
    k := left(k, 64);
    key_type := split_part(k, ':', 1);
    key_value := k;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION derive_blocking_keys(text, text, int) IS
  'SQL port of PersonService._queryKeys — set-based blocking-key derivation for the bulk-lead-ingest path. Keep in sync with the JS.';
