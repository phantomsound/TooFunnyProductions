--
-- PostgreSQL database dump
--

\restrict YgeqiGl5ganw2GaUdwE23TnDuPavFcArbGNgxd6mXVFjB9atSnfQPxF42hn7PbL

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end$$;


--
-- Name: add_prefixes(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.add_prefixes(_bucket_id text, _name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: delete_leaf_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$$;


--
-- Name: delete_prefix(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix(_bucket_id text, _name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Check if we can delete the prefix
    IF EXISTS(
        SELECT FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name") + 1
          AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    )
    OR EXISTS(
        SELECT FROM "storage"."objects"
        WHERE "objects"."bucket_id" = "_bucket_id"
          AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
          AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    ) THEN
    -- There are sub-objects, skip deletion
    RETURN false;
    ELSE
        DELETE FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name")
          AND "prefixes"."name" = "_name";
        RETURN true;
    END IF;
END;
$$;


--
-- Name: delete_prefix_hierarchy_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix_hierarchy_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


--
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


--
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(name COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                        substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
                    ELSE
                        name
                END AS name, id, metadata, updated_at
            FROM
                storage.objects
            WHERE
                bucket_id = $5 AND
                name ILIKE $1 || ''%'' AND
                CASE
                    WHEN $6 != '''' THEN
                    name COLLATE "C" > $6
                ELSE true END
                AND CASE
                    WHEN $4 != '''' THEN
                        CASE
                            WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                                substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                name COLLATE "C" > $4
                            END
                    ELSE
                        true
                END
            ORDER BY
                name COLLATE "C" ASC) as e order by name COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
END;
$_$;


--
-- Name: lock_top_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.lock_top_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket text;
    v_top text;
BEGIN
    FOR v_bucket, v_top IN
        SELECT DISTINCT t.bucket_id,
            split_part(t.name, '/', 1) AS top
        FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        WHERE t.name <> ''
        ORDER BY 1, 2
        LOOP
            PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket || '/' || v_top, 0));
        END LOOP;
END;
$$;


--
-- Name: objects_delete_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_delete_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$$;


--
-- Name: objects_insert_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_insert_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- Name: objects_update_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    -- NEW - OLD (destinations to create prefixes for)
    v_add_bucket_ids text[];
    v_add_names      text[];

    -- OLD - NEW (sources to prune)
    v_src_bucket_ids text[];
    v_src_names      text[];
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NULL;
    END IF;

    -- 1) Compute NEW−OLD (added paths) and OLD−NEW (moved-away paths)
    WITH added AS (
        SELECT n.bucket_id, n.name
        FROM new_rows n
        WHERE n.name <> '' AND position('/' in n.name) > 0
        EXCEPT
        SELECT o.bucket_id, o.name FROM old_rows o WHERE o.name <> ''
    ),
    moved AS (
         SELECT o.bucket_id, o.name
         FROM old_rows o
         WHERE o.name <> ''
         EXCEPT
         SELECT n.bucket_id, n.name FROM new_rows n WHERE n.name <> ''
    )
    SELECT
        -- arrays for ADDED (dest) in stable order
        COALESCE( (SELECT array_agg(a.bucket_id ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        COALESCE( (SELECT array_agg(a.name      ORDER BY a.bucket_id, a.name) FROM added a), '{}' ),
        -- arrays for MOVED (src) in stable order
        COALESCE( (SELECT array_agg(m.bucket_id ORDER BY m.bucket_id, m.name) FROM moved m), '{}' ),
        COALESCE( (SELECT array_agg(m.name      ORDER BY m.bucket_id, m.name) FROM moved m), '{}' )
    INTO v_add_bucket_ids, v_add_names, v_src_bucket_ids, v_src_names;

    -- Nothing to do?
    IF (array_length(v_add_bucket_ids, 1) IS NULL) AND (array_length(v_src_bucket_ids, 1) IS NULL) THEN
        RETURN NULL;
    END IF;

    -- 2) Take per-(bucket, top) locks: ALL prefixes in consistent global order to prevent deadlocks
    DECLARE
        v_all_bucket_ids text[];
        v_all_names text[];
    BEGIN
        -- Combine source and destination arrays for consistent lock ordering
        v_all_bucket_ids := COALESCE(v_src_bucket_ids, '{}') || COALESCE(v_add_bucket_ids, '{}');
        v_all_names := COALESCE(v_src_names, '{}') || COALESCE(v_add_names, '{}');

        -- Single lock call ensures consistent global ordering across all transactions
        IF array_length(v_all_bucket_ids, 1) IS NOT NULL THEN
            PERFORM storage.lock_top_prefixes(v_all_bucket_ids, v_all_names);
        END IF;
    END;

    -- 3) Create destination prefixes (NEW−OLD) BEFORE pruning sources
    IF array_length(v_add_bucket_ids, 1) IS NOT NULL THEN
        WITH candidates AS (
            SELECT DISTINCT t.bucket_id, unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(v_add_bucket_ids, v_add_names) AS t(bucket_id, name)
            WHERE name <> ''
        )
        INSERT INTO storage.prefixes (bucket_id, name)
        SELECT c.bucket_id, c.name
        FROM candidates c
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4) Prune source prefixes bottom-up for OLD−NEW
    IF array_length(v_src_bucket_ids, 1) IS NOT NULL THEN
        -- re-entrancy guard so DELETE on prefixes won't recurse
        IF current_setting('storage.gc.prefixes', true) <> '1' THEN
            PERFORM set_config('storage.gc.prefixes', '1', true);
        END IF;

        PERFORM storage.delete_leaf_prefixes(v_src_bucket_ids, v_src_names);
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: objects_update_level_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_level_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Set the new level
        NEW."level" := "storage"."get_level"(NEW."name");
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: objects_update_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_prefixes TEXT[];
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Retrieve old prefixes
        old_prefixes := "storage"."get_prefixes"(OLD."name");

        -- Remove old prefixes that are only used by this object
        WITH all_prefixes as (
            SELECT unnest(old_prefixes) as prefix
        ),
        can_delete_prefixes as (
             SELECT prefix
             FROM all_prefixes
             WHERE NOT EXISTS (
                 SELECT 1 FROM "storage"."objects"
                 WHERE "bucket_id" = OLD."bucket_id"
                   AND "name" <> OLD."name"
                   AND "name" LIKE (prefix || '%')
             )
         )
        DELETE FROM "storage"."prefixes" WHERE name IN (SELECT prefix FROM can_delete_prefixes);

        -- Add new prefixes
        PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    END IF;
    -- Set the new level
    NEW."level" := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: prefixes_delete_cleanup(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.prefixes_delete_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_bucket_ids text[];
    v_names      text[];
BEGIN
    IF current_setting('storage.gc.prefixes', true) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('storage.gc.prefixes', '1', true);

    SELECT COALESCE(array_agg(d.bucket_id), '{}'),
           COALESCE(array_agg(d.name), '{}')
    INTO v_bucket_ids, v_names
    FROM deleted AS d
    WHERE d.name <> '';

    PERFORM storage.lock_top_prefixes(v_bucket_ids, v_names);
    PERFORM storage.delete_leaf_prefixes(v_bucket_ids, v_names);

    RETURN NULL;
END;
$$;


--
-- Name: prefixes_insert_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.prefixes_insert_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
declare
    can_bypass_rls BOOLEAN;
begin
    SELECT rolbypassrls
    INTO can_bypass_rls
    FROM pg_roles
    WHERE rolname = coalesce(nullif(current_setting('role', true), 'none'), current_user);

    IF can_bypass_rls THEN
        RETURN QUERY SELECT * FROM storage.search_v1_optimised(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    ELSE
        RETURN QUERY SELECT * FROM storage.search_legacy_v1(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    END IF;
end;
$$;


--
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- Name: search_v1_optimised(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v1_optimised(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select (string_to_array(name, ''/''))[level] as name
           from storage.prefixes
             where lower(prefixes.name) like lower($2 || $3) || ''%''
               and bucket_id = $4
               and level = $1
           order by name ' || v_sort_order || '
     )
     (select name,
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[level] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where lower(objects.name) like lower($2 || $3) || ''%''
       and bucket_id = $4
       and level = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    sort_col text;
    sort_ord text;
    cursor_op text;
    cursor_expr text;
    sort_expr text;
BEGIN
    -- Validate sort_order
    sort_ord := lower(sort_order);
    IF sort_ord NOT IN ('asc', 'desc') THEN
        sort_ord := 'asc';
    END IF;

    -- Determine cursor comparison operator
    IF sort_ord = 'asc' THEN
        cursor_op := '>';
    ELSE
        cursor_op := '<';
    END IF;
    
    sort_col := lower(sort_column);
    -- Validate sort column  
    IF sort_col IN ('updated_at', 'created_at') THEN
        cursor_expr := format(
            '($5 = '''' OR ROW(date_trunc(''milliseconds'', %I), name COLLATE "C") %s ROW(COALESCE(NULLIF($6, '''')::timestamptz, ''epoch''::timestamptz), $5))',
            sort_col, cursor_op
        );
        sort_expr := format(
            'COALESCE(date_trunc(''milliseconds'', %I), ''epoch''::timestamptz) %s, name COLLATE "C" %s',
            sort_col, sort_ord, sort_ord
        );
    ELSE
        cursor_expr := format('($5 = '''' OR name COLLATE "C" %s $5)', cursor_op);
        sort_expr := format('name COLLATE "C" %s', sort_ord);
    END IF;

    RETURN QUERY EXECUTE format(
        $sql$
        SELECT * FROM (
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    NULL::uuid AS id,
                    updated_at,
                    created_at,
                    NULL::timestamptz AS last_accessed_at,
                    NULL::jsonb AS metadata
                FROM storage.prefixes
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
            UNION ALL
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name,
                    id,
                    updated_at,
                    created_at,
                    last_accessed_at,
                    metadata
                FROM storage.objects
                WHERE name COLLATE "C" LIKE $1 || '%%'
                    AND bucket_id = $2
                    AND level = $4
                    AND %s
                ORDER BY %s
                LIMIT $3
            )
        ) obj
        ORDER BY %s
        LIMIT $3
        $sql$,
        cursor_expr,    -- prefixes WHERE
        sort_expr,      -- prefixes ORDER BY
        cursor_expr,    -- objects WHERE
        sort_expr,      -- objects ORDER BY
        sort_expr       -- final ORDER BY
    )
    USING prefix, bucket_name, limits, levels, start_after, sort_column_after;
END;
$_$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_email text NOT NULL,
    action text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb
);


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    email text,
    message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    location text,
    date date NOT NULL,
    description text,
    ticket_url text,
    image_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    video_url text,
    thumbnail_url text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: merch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    price numeric(10,2),
    image_url text,
    description text,
    stock integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hero_title text,
    hero_subtext text,
    footer_text text,
    contactemail text,
    contactphone text,
    updated_at timestamp with time zone DEFAULT now(),
    hero_image text DEFAULT 'https://placehold.co/1200x600/000000/FFF?text=Too+Funny'::text,
    featured_video_url text DEFAULT 'https://www.youtube.com/embed/dQw4w9WgXcQ'::text,
    accent_color text DEFAULT '#FFD700'::text,
    background_gradient text DEFAULT 'linear-gradient(to right, #000000, #1a1a40)'::text,
    theme_home jsonb DEFAULT '{}'::jsonb,
    theme_about jsonb DEFAULT '{}'::jsonb,
    theme_events jsonb DEFAULT '{}'::jsonb,
    theme_media jsonb DEFAULT '{}'::jsonb,
    theme_merch jsonb DEFAULT '{}'::jsonb,
    theme_contact jsonb DEFAULT '{}'::jsonb,
    footer_links jsonb DEFAULT '[]'::jsonb,
    contact_socials jsonb DEFAULT '[]'::jsonb,
    inserted_at timestamp with time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    logo_url text,
    favicon_url text,
    meta_title text,
    meta_description text,
    meta_keywords text,
    site_title text,
    site_description text,
    site_keywords text,
    maintenance_enabled boolean DEFAULT false NOT NULL,
    maintenance_message text,
    theme_primary text,
    theme_accent text,
    maintenance_schedule_enabled boolean DEFAULT false NOT NULL,
    maintenance_daily_start text,
    maintenance_daily_end text,
    maintenance_timezone text
);

ALTER TABLE ONLY public.settings FORCE ROW LEVEL SECURITY;


--
-- Name: settings_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_deployments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    fallback_snapshot_id uuid,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    updated_by text,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    override_reason text,
    activated_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: settings_draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_draft (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_title text,
    site_description text,
    site_keywords text,
    logo_url text,
    favicon_url text,
    footer_text text,
    hero_title text,
    hero_subtext text,
    hero_image_url text,
    featured_video_url text,
    contactemail text,
    contactphone text,
    accent_color text,
    background_gradient text,
    maintenance_enabled boolean DEFAULT false,
    maintenance_message text,
    maintenance_schedule_enabled boolean DEFAULT false,
    maintenance_daily_start text,
    maintenance_daily_end text,
    maintenance_timezone text,
    updated_at timestamp with time zone DEFAULT now(),
    contact_socials jsonb DEFAULT '{}'::jsonb,
    theme_accent text DEFAULT '#FFD700'::text,
    theme_bg text DEFAULT 'linear-gradient(to right, #000, #1a1a40)'::text,
    footer_links jsonb DEFAULT '[]'::jsonb,
    admin_timeout_minutes integer DEFAULT 30,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    header_bg text DEFAULT '#000000'::text,
    footer_bg text DEFAULT '#000000'::text,
    session_timeout_minutes integer DEFAULT 30,
    who_title text,
    who_body text,
    who_cta_label text,
    who_cta_url text,
    about_title text,
    about_body text,
    about_mission_title text,
    about_mission_body text,
    about_team_intro text,
    about_team jsonb DEFAULT '[]'::jsonb,
    events_title text,
    events_intro text,
    events_upcoming jsonb DEFAULT '[]'::jsonb,
    events_past jsonb DEFAULT '[]'::jsonb,
    media_title text,
    media_intro text,
    media_sections jsonb DEFAULT '[]'::jsonb,
    merch_title text,
    merch_intro text,
    merch_items jsonb DEFAULT '[]'::jsonb,
    contact_title text,
    contact_intro text,
    contact_cards jsonb DEFAULT '[]'::jsonb,
    admin_quick_links jsonb DEFAULT '[]'::jsonb,
    who_image_url text,
    theme_use_global boolean DEFAULT true,
    hero_title_size text DEFAULT 'medium'::text,
    hero_subtext_size text DEFAULT 'medium'::text,
    hero_badge_size text DEFAULT 'medium'::text,
    hero_title_font_size text,
    hero_subtext_font_size text,
    hero_badge_font_size text
);


--
-- Name: settings_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_lock (
    id integer DEFAULT 1 NOT NULL,
    holder_email text,
    acquired_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active_version_id uuid,
    source_version_id uuid,
    auto_saved_version_id uuid
);


--
-- Name: settings_public; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_public (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hero_title text,
    hero_subtext text,
    footer_text text,
    contactemail text,
    contactphone text,
    updated_at timestamp with time zone DEFAULT now(),
    hero_image text,
    featured_video_url text,
    accent_color text,
    background_gradient text,
    theme_home jsonb,
    theme_about jsonb,
    theme_events jsonb,
    theme_media jsonb,
    theme_merch jsonb,
    theme_contact jsonb,
    footer_links jsonb DEFAULT '[]'::jsonb,
    contact_socials jsonb DEFAULT '{}'::jsonb,
    inserted_at timestamp with time zone,
    created_at timestamp without time zone DEFAULT now(),
    logo_url text,
    favicon_url text,
    meta_title text,
    meta_description text,
    meta_keywords text,
    site_title text,
    site_description text,
    site_keywords text,
    maintenance_enabled boolean,
    maintenance_message text,
    theme_primary text,
    theme_accent text DEFAULT '#FFD700'::text,
    maintenance_schedule_enabled boolean,
    maintenance_daily_start text,
    maintenance_daily_end text,
    maintenance_timezone text,
    hero_image_url text,
    theme_bg text DEFAULT 'linear-gradient(to right, #000, #1a1a40)'::text,
    published_at timestamp with time zone,
    admin_timeout_minutes integer DEFAULT 30,
    header_bg text,
    footer_bg text,
    session_timeout_minutes integer,
    who_title text,
    who_body text,
    who_cta_label text,
    who_cta_url text,
    about_title text,
    about_body text,
    about_mission_title text,
    about_mission_body text,
    about_team_intro text,
    about_team jsonb DEFAULT '[]'::jsonb,
    events_title text,
    events_intro text,
    events_upcoming jsonb DEFAULT '[]'::jsonb,
    events_past jsonb DEFAULT '[]'::jsonb,
    media_title text,
    media_intro text,
    media_sections jsonb DEFAULT '[]'::jsonb,
    merch_title text,
    merch_intro text,
    merch_items jsonb DEFAULT '[]'::jsonb,
    contact_title text,
    contact_intro text,
    contact_cards jsonb DEFAULT '[]'::jsonb,
    admin_quick_links jsonb DEFAULT '[]'::jsonb,
    who_image_url text,
    theme_use_global boolean DEFAULT true,
    hero_title_size text,
    hero_subtext_size text,
    hero_badge_size text,
    hero_title_font_size text,
    hero_subtext_font_size text,
    hero_badge_font_size text
);


--
-- Name: settings_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage text DEFAULT 'draft'::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    label text,
    author_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    note text,
    kind text DEFAULT 'draft'::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    is_default boolean DEFAULT false
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    level integer
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: prefixes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.prefixes (
    bucket_id text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    level integer GENERATED ALWAYS AS (storage.get_level(name)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: admin_actions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.admin_actions (id, actor_email, action, payload, created_at, occurred_at, meta) FROM stdin;
2ee402d0-f093-4d1f-8965-d35157178262	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 04:51:37.374736+00	2025-10-22 01:04:42.022359+00	\N
aa01d432-2795-4d4e-aae7-a3c5ff44998f	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 05:03:19.071508+00	2025-10-22 01:04:42.022359+00	\N
afa355e1-bff5-4750-be0e-a923be4bad30	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 05:18:26.147259+00	2025-10-22 01:04:42.022359+00	\N
38aea14f-ba65-4030-adbc-64e2d0a226a9	kmiko28@gmail.com	logout	\N	2025-10-08 05:18:38.889806+00	2025-10-22 01:04:42.022359+00	\N
7c61e1f8-8d48-426b-aa2c-15853556ff3d	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 05:18:49.427293+00	2025-10-22 01:04:42.022359+00	\N
bc4770ea-5b44-4de8-ab8b-6a26b973000a	kmiko28@gmail.com	logout	\N	2025-10-08 05:19:10.377582+00	2025-10-22 01:04:42.022359+00	\N
5cfca4fe-ee78-450a-8ccd-b2c3916f8d52	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 05:19:39.628811+00	2025-10-22 01:04:42.022359+00	\N
40d91e7c-db7c-45ab-9543-3678f958cafc	kmiko28@gmail.com	logout	\N	2025-10-08 05:20:17.538609+00	2025-10-22 01:04:42.022359+00	\N
bf6a8d7c-0d0e-4c69-b828-04e5a6282d5f	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 21:36:28.001233+00	2025-10-22 01:04:42.022359+00	\N
ee28ea94-0df2-4f72-947c-e7ef303de5c0	kmiko28@gmail.com	logout	\N	2025-10-08 21:36:30.861429+00	2025-10-22 01:04:42.022359+00	\N
2da99a26-d2b4-4b85-b27a-804c9f07eed4	louisbeining@gmail.com	login	{"name": "Louis Beining"}	2025-10-08 21:36:36.28728+00	2025-10-22 01:04:42.022359+00	\N
d2c91ac3-2ef1-45b4-bf99-c6eb86cadb65	kmiko28@gmail.com	login	{"name": "Kevin Miko"}	2025-10-08 21:36:42.833693+00	2025-10-22 01:04:42.022359+00	\N
d4e4c191-f953-4885-b42a-33b00f125c13	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://placehold.co/1200x600/000000/FFF?text=TooFunny", "hero_title": "Comedy that’s Too Funnyasdf", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:37:46.591Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://drive.google.com/file/d/1BSWMQmZji1dx6oZDzfN4U0g5ble8MEqF/preview", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:37:47.858845+00	2025-10-22 01:04:42.022359+00	\N
52023b07-67de-4d65-b560-47e3b333d3a9	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://placehold.co/1200x600/000000/FFF?text=TooFunny", "hero_title": "Comedy that’s Too Funnyasdf", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:38:47.125Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.fdsa", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://drive.google.com/file/d/1BSWMQmZji1dx6oZDzfN4U0g5ble8MEqF/preview", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:38:48.327483+00	2025-10-22 01:04:42.022359+00	\N
0685c535-190d-4999-a860-8e75e6af9008	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://placehold.co/1200x600/000000/FFF?text=TooFunny", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:39:01.556Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://drive.google.com/file/d/1BSWMQmZji1dx6oZDzfN4U0g5ble8MEqF/preview", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:39:02.77188+00	2025-10-22 01:04:42.022359+00	\N
9c455aed-682b-4457-9b4b-d5cf0e00e360	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:39:20.987Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://drive.google.com/file/d/1BSWMQmZji1dx6oZDzfN4U0g5ble8MEqF/preview", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:39:22.197733+00	2025-10-22 01:04:42.022359+00	\N
9900063f-e5ab-450d-8dba-ef692b1f3d9d	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyadf", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:18:11.127Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:18:14.055874+00	2025-10-22 01:04:42.022359+00	\N
00e6443a-7aa7-4e78-b8a4-e5512ffd1227	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:40:09.906309+00	2025-10-22 01:04:42.022359+00	\N
dc7904c4-269a-4eab-8f05-92faf762c492	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyeeeeeeeeeee", "updated_at": "2025-10-14T04:40:11.860Z"}	2025-10-14 04:40:15.534141+00	2025-10-22 01:04:42.022359+00	\N
275fdfd4-4d2d-47e8-8f07-7fe8ea6fc1bd	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:41:25.222Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759959683101_TFPMainVideo1.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:41:27.022287+00	2025-10-22 01:04:42.022359+00	\N
d30df836-fbac-42cb-806d-22e5d5010daa	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-08T21:41:42.842Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759959683101_TFPMainVideo1.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-08 21:41:44.287249+00	2025-10-22 01:04:42.022359+00	\N
cf060b6b-12e4-4be8-9763-aa8b192e1cac	kmiko28@gmail.com	login	\N	2025-10-09 21:52:44.394431+00	2025-10-22 01:04:42.022359+00	\N
5aa8bb19-34af-47aa-8404-eb01c2851086	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-09T22:06:28.501Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759959683101_TFPMainVideo1.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-09 22:06:29.826033+00	2025-10-22 01:04:42.022359+00	\N
5f2c3f1a-0424-46f5-ae05-61b8d4338ff2	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-09T22:06:28.554Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759959683101_TFPMainVideo1.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-09 22:06:29.837623+00	2025-10-22 01:04:42.022359+00	\N
cfa31e43-28be-4b31-80a3-425056d3d962	kmiko28@gmail.com	logout	\N	2025-10-09 23:03:47.002863+00	2025-10-22 01:04:42.022359+00	\N
a2b46633-a3b9-4af5-9487-60b0dd01ff30	kmiko28@gmail.com	logout	\N	2025-10-09 23:03:47.00285+00	2025-10-22 01:04:42.022359+00	\N
5c7e3cb3-535e-48f0-9571-fb71f16f0555	kmiko28@gmail.com	login	\N	2025-10-10 00:04:54.342386+00	2025-10-22 01:04:42.022359+00	\N
bbb66893-eb69-43b9-ab72-eb65c1523763	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-10T00:08:42.576Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-10 00:08:44.228454+00	2025-10-22 01:04:42.022359+00	\N
6c0b85dd-e4fc-4e1d-be4a-93040b2de237	kmiko28@gmail.com	logout	\N	2025-10-10 00:30:46.402892+00	2025-10-22 01:04:42.022359+00	\N
74955312-04d6-4eb9-97ec-ddfb37efbda5	kmiko28@gmail.com	logout	\N	2025-10-10 00:30:46.432584+00	2025-10-22 01:04:42.022359+00	\N
5271e3fd-c308-4b99-923d-1a50a853045a	kmiko28@gmail.com	login	\N	2025-10-13 01:29:44.915289+00	2025-10-22 01:04:42.022359+00	\N
126a76cf-a2ce-42f5-b6ab-9b8d3d637882	kmiko28@gmail.com	login	\N	2025-10-13 03:19:35.341428+00	2025-10-22 01:04:42.022359+00	\N
17c297d1-475f-4d68-b584-ea7e576c043d	kmiko28@gmail.com	settings.update	{"id": "251f0f97-5318-4802-97d4-1b27cd7e20ca", "logo_url": null, "created_at": "2025-10-05T19:18:51.833727", "hero_image": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "hero_title": "Comedy that’s Too Funny", "meta_title": null, "site_title": null, "theme_home": {}, "updated_at": "2025-10-13T03:19:37.890Z", "favicon_url": null, "footer_text": "© 2025 Too Funny Productions. All rights reserved.", "inserted_at": "2025-10-05T19:18:51.833727+00:00", "theme_about": {}, "theme_media": {}, "theme_merch": {}, "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "theme_events": {}, "meta_keywords": null, "site_keywords": null, "theme_contact": {}, "theme_primary": null, "contact_socials": [], "meta_description": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "background_gradient": "linear-gradient(to right, #000000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": false}	2025-10-13 03:19:40.763857+00	2025-10-22 01:04:42.022359+00	\N
d32847d4-f8c2-4cd8-a6d0-dfb8b35d21c0	kmiko28@gmail.com	login	\N	2025-10-13 03:49:03.288886+00	2025-10-22 01:04:42.022359+00	\N
26a0c544-7a3c-48bf-a4c9-bf7bbefda2dc	kmiko28@gmail.com	login	\N	2025-10-13 14:42:29.464435+00	2025-10-22 01:04:42.022359+00	\N
b3f8c2f8-dae9-4ef4-8488-63b27377c313	kmiko28@gmail.com	login	\N	2025-10-13 14:46:24.26953+00	2025-10-22 01:04:42.022359+00	\N
5ee4ee8b-25f2-409d-83ce-26aab7ee76f5	kmiko28@gmail.com	logout	\N	2025-10-13 17:57:26.67904+00	2025-10-22 01:04:42.022359+00	\N
851b0028-080d-4643-bb97-ae47cca5f82e	kmiko28@gmail.com	logout	\N	2025-10-13 17:57:26.67904+00	2025-10-22 01:04:42.022359+00	\N
7fd34b52-da80-4b63-83f6-76a4710d8c40	kmiko28@gmail.com	login	\N	2025-10-13 22:24:14.274808+00	2025-10-22 01:04:42.022359+00	\N
793eb1a5-c585-4baa-be4f-c216428888e7	kmiko28@gmail.com	login	\N	2025-10-13 22:46:13.598197+00	2025-10-22 01:04:42.022359+00	\N
3ae5409e-0107-48c4-8d4b-c50a1000064e	kmiko28@gmail.com	login	\N	2025-10-13 22:55:43.610464+00	2025-10-22 01:04:42.022359+00	\N
90c97a03-4706-4121-be9e-3b2b9f983b97	kmiko28@gmail.com	logout	\N	2025-10-13 23:08:26.01956+00	2025-10-22 01:04:42.022359+00	\N
4e86ad90-22c9-4172-98d2-b9033a3ea0c0	kmiko28@gmail.com	logout	\N	2025-10-13 23:08:26.019542+00	2025-10-22 01:04:42.022359+00	\N
7e8fb40d-31bf-4dde-b3a6-27adf1994355	kmiko28@gmail.com	login	\N	2025-10-13 23:09:29.140794+00	2025-10-22 01:04:42.022359+00	\N
c6924861-fd3d-4bbc-bb95-f55a6cf75584	kmiko28@gmail.com	settings.pull_live_to_draft	{"draftId": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-13 23:09:31.944097+00	2025-10-22 01:04:42.022359+00	\N
7f55abba-3919-4fdb-b50e-b9d9b4061734	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasdf", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:09:33.491Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:09:36.342506+00	2025-10-22 01:04:42.022359+00	\N
375b47ec-c7b9-4d1d-919b-34f205643c68	kmiko28@gmail.com	settings.pull_live_to_draft	{"draftId": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-13 23:10:30.345362+00	2025-10-22 01:04:42.022359+00	\N
939a0d4a-03d7-4e2b-9501-f460a1e37319	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:10:33.791Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:10:36.652363+00	2025-10-22 01:04:42.022359+00	\N
7329797e-ae4e-4004-8b87-d185adf5340b	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasdf", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:10:37.134Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:10:39.931421+00	2025-10-22 01:04:42.022359+00	\N
2baeaa2e-1545-4d4d-85f2-275ea8bf8639	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:11:09.228Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:11:12.089694+00	2025-10-22 01:04:42.022359+00	\N
6b8c07a3-8c0b-4a62-a98d-c44e1085f3a9	kmiko28@gmail.com	settings.pull_live_to_draft	{"draftId": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-13 23:12:12.080529+00	2025-10-22 01:04:42.022359+00	\N
0049e940-cfeb-4b22-9302-d2dd9461761d	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyadf", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:12:13.142Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:12:15.978081+00	2025-10-22 01:04:42.022359+00	\N
b9b4ab03-924e-4ed8-a9f9-4d4082a79ca8	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyadf", "site_title": "Too Funny Productions", "updated_at": "2025-10-13T23:18:11.160Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-13 23:18:14.050498+00	2025-10-22 01:04:42.022359+00	\N
f7b1266f-4c40-4d4a-be82-986d669aa4a0	unknown	logout	\N	2025-10-14 00:18:18.818717+00	2025-10-22 01:04:42.022359+00	\N
d6caad45-f81f-4966-b6d1-8a17e2e4c565	unknown	logout	\N	2025-10-14 00:18:18.818717+00	2025-10-22 01:04:42.022359+00	\N
e550eb2f-d71b-4619-927d-36040d1cc4b7	kmiko28@gmail.com	login	\N	2025-10-14 00:21:07.572646+00	2025-10-22 01:04:42.022359+00	\N
80cb4114-01de-4305-9b90-94eac5e49668	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:38:53.159589+00	2025-10-22 01:04:42.022359+00	\N
24accf0a-4c9e-4cf1-9b6c-5d73473abebb	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasd", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:21:11.481Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:21:14.517723+00	2025-10-22 01:04:42.022359+00	\N
8cf281e8-2664-4378-9891-d648fcce3d65	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasd", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:26:44.708Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:26:47.910227+00	2025-10-22 01:04:42.022359+00	\N
60fea072-6d3e-4942-99cf-800f66085a26	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasd", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:26:44.714Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:26:47.935541+00	2025-10-22 01:04:42.022359+00	\N
16fe7992-5e3e-4fa1-8b16-4acc6379dc41	kmiko28@gmail.com	logout	\N	2025-10-14 00:31:17.905595+00	2025-10-22 01:04:42.022359+00	\N
f60c7401-4259-4eda-bc6d-11749076119f	kmiko28@gmail.com	logout	\N	2025-10-14 00:31:17.920969+00	2025-10-22 01:04:42.022359+00	\N
a8fd9605-7ddc-4da9-981c-31ace93783c2	kmiko28@gmail.com	login	\N	2025-10-14 00:31:33.708445+00	2025-10-22 01:04:42.022359+00	\N
a461799a-ceec-46ee-b257-e3bfacc69d55	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 00:31:39.33734+00	2025-10-22 01:04:42.022359+00	\N
83cc0c50-e288-4e8c-8d10-6976a85f7716	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyasdffdsa", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:31:43.961Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:31:47.109213+00	2025-10-22 01:04:42.022359+00	\N
6615b842-cae5-49fe-bd68-f6c9d389f7d5	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:32:07.242Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:32:10.246653+00	2025-10-22 01:04:42.022359+00	\N
e5d2b4f8-3884-4feb-acf7-e8f7e5476da0	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 00:32:36.404951+00	2025-10-22 01:04:42.022359+00	\N
60162be0-8698-4621-b378-279747774ee8	kmiko28@gmail.com	settings.update.draft	{"updated_at": "2025-10-14T00:32:36.359Z"}	2025-10-14 00:32:39.43385+00	2025-10-22 01:04:42.022359+00	\N
fb39b171-7e51-496c-8dc8-086f3e6e9110	kmiko28@gmail.com	settings.publish	{"id": null}	2025-10-14 00:32:42.388549+00	2025-10-22 01:04:42.022359+00	\N
f8ce098a-5d13-480d-a001-f63ff4a48524	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:38:14.132Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:38:17.185372+00	2025-10-22 01:04:42.022359+00	\N
c306df56-0a54-42c9-9ec7-eef3546199e1	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-14T00:38:14.098Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-14 00:38:17.190151+00	2025-10-22 01:04:42.022359+00	\N
c99e1164-24b8-4849-83f9-e9eba60170ba	kmiko28@gmail.com	logout	\N	2025-10-14 04:20:06.98766+00	2025-10-22 01:04:42.022359+00	\N
fdde5439-ad9f-4901-8a64-1ece330b2326	kmiko28@gmail.com	logout	\N	2025-10-14 04:20:06.987651+00	2025-10-22 01:04:42.022359+00	\N
d64c8b9f-956b-479d-9cb7-81c71991e613	kmiko28@gmail.com	login	\N	2025-10-14 04:22:18.244363+00	2025-10-22 01:04:42.022359+00	\N
ce595322-4c70-4c70-b705-95157f7dbc5e	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:22:21.303847+00	2025-10-22 01:04:42.022359+00	\N
4a527db4-03c6-4397-ad4e-f52544002b57	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyfdsa", "updated_at": "2025-10-14T04:22:22.028Z"}	2025-10-14 04:22:25.657175+00	2025-10-22 01:04:42.022359+00	\N
17fd55e9-b32c-407c-9335-0b5d7aa88c8e	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:22:55.090886+00	2025-10-22 01:04:42.022359+00	\N
ce702814-5d44-4eeb-8783-bf0c1d301ba4	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyd", "updated_at": "2025-10-14T04:22:59.949Z"}	2025-10-14 04:23:03.572748+00	2025-10-22 01:04:42.022359+00	\N
c1efb144-421c-46f5-a56a-e94ea6c359bb	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:23:33.137149+00	2025-10-22 01:04:42.022359+00	\N
407ad354-1215-4f34-bcd9-52ed7cdd261e	kmiko28@gmail.com	settings.update.draft	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png", "updated_at": "2025-10-14T04:24:04.025Z", "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png"}	2025-10-14 04:24:07.713357+00	2025-10-22 01:04:42.022359+00	\N
46440f33-e116-40ca-8e23-7657da5c61b8	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:38:07.247498+00	2025-10-22 01:04:42.022359+00	\N
417dacdc-abad-457c-9919-2bcac546d1ed	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyeeeee", "updated_at": "2025-10-14T04:38:08.017Z"}	2025-10-14 04:38:11.693874+00	2025-10-22 01:04:42.022359+00	\N
4a5dcade-34a0-48e8-9ac7-1f4302881226	kmiko28@gmail.com	login	\N	2025-10-14 04:40:01.331257+00	2025-10-22 01:04:42.022359+00	\N
8444aa3b-93a7-46c1-bbdf-81f7942f57d5	kmiko28@gmail.com	settings.publish	{"id": null}	2025-10-14 04:40:26.826962+00	2025-10-22 01:04:42.022359+00	\N
d8ba780c-a15c-4ecb-9088-9274f53f4c5b	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 04:57:42.705702+00	2025-10-22 01:04:42.022359+00	\N
5255e0e7-8995-490e-8aa1-aafb30c941fc	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyddddd", "updated_at": "2025-10-14T04:58:22.361Z"}	2025-10-14 04:58:26.105232+00	2025-10-22 01:04:42.022359+00	\N
4376ec5b-97fd-4d5c-8a96-e9a16f1cb64a	kmiko28@gmail.com	logout	\N	2025-10-14 05:03:59.386002+00	2025-10-22 01:04:42.022359+00	\N
76924dac-0fe2-4bfd-b54a-cd67bec8d5cf	kmiko28@gmail.com	logout	\N	2025-10-14 05:03:59.385929+00	2025-10-22 01:04:42.022359+00	\N
606e6e0a-412c-43b7-81fc-69e4fc750ec9	kmiko28@gmail.com	login	\N	2025-10-14 05:11:19.644679+00	2025-10-22 01:04:42.022359+00	\N
9aff209d-6170-4757-b614-5a7c1bc0a5dd	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 05:11:21.903549+00	2025-10-22 01:04:42.022359+00	\N
ba5e52af-828c-470e-bfaa-c47f0dc495fd	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyddddddddddddddd", "updated_at": "2025-10-14T05:11:22.117Z"}	2025-10-14 05:11:25.851616+00	2025-10-22 01:04:42.022359+00	\N
c70bf5a5-e285-4342-80eb-3ec7d8c7cc91	kmiko28@gmail.com	settings.publish	{"id": null}	2025-10-14 05:11:37.695346+00	2025-10-22 01:04:42.022359+00	\N
5bb097c7-60dc-45d2-9c47-dcd8aff66622	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 05:11:43.203957+00	2025-10-22 01:04:42.022359+00	\N
4468d71e-e6fb-499b-a632-e4345d785aaa	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 05:11:48.809532+00	2025-10-22 01:04:42.022359+00	\N
1466b2d8-64bc-4605-9f1f-fd6676fc0257	kmiko28@gmail.com	settings.pull_live_to_draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12"}	2025-10-14 05:12:03.294203+00	2025-10-22 01:04:42.022359+00	\N
59912109-a113-4263-85e8-c10daa4dabee	kmiko28@gmail.com	settings.publish	{"id": null}	2025-10-14 05:12:05.793644+00	2025-10-22 01:04:42.022359+00	\N
837fb5b3-0ef0-45fd-8bc6-a975f9ad4b30	kmiko28@gmail.com	settings.update.draft	{"hero_title": "Comedy that's Too Funnyddf", "updated_at": "2025-10-14T05:12:13.724Z"}	2025-10-14 05:12:17.459992+00	2025-10-22 01:04:42.022359+00	\N
2359452c-6214-4f97-ad82-8bda9eca1ca7	kmiko28@gmail.com	settings.publish	{"id": null}	2025-10-14 05:12:37.941757+00	2025-10-22 01:04:42.022359+00	\N
7e386c5f-ac88-4ab4-8af0-ace05afbd9ae	kmiko28@gmail.com	login	\N	2025-10-14 06:16:19.268074+00	2025-10-22 01:04:42.022359+00	\N
08c1eee0-0a44-4de1-873d-cc1291034e74	kmiko28@gmail.com	logout	\N	2025-10-14 21:50:20.60364+00	2025-10-22 01:04:42.022359+00	\N
054bd653-af9e-4ff8-be52-b505acfdf034	kmiko28@gmail.com	login	\N	2025-10-14 21:50:32.067101+00	2025-10-22 01:04:42.022359+00	\N
47a16901-99c5-4911-a2ca-fe288922cac6	kmiko28@gmail.com	login	\N	2025-10-14 22:28:00.439063+00	2025-10-22 01:04:42.022359+00	\N
253756da-b7ab-42e8-9fa1-23e69c15480f	kmiko28@gmail.com	login	\N	2025-10-14 22:39:08.492062+00	2025-10-22 01:04:42.022359+00	\N
1094a8fa-38b9-46e5-9e3b-9e85adf88d6b	kmiko28@gmail.com	logout	\N	2025-10-14 23:41:09.601483+00	2025-10-22 01:04:42.022359+00	\N
3ba85556-4deb-46ea-961b-4caec3c1b564	kmiko28@gmail.com	login	\N	2025-10-14 23:42:44.046182+00	2025-10-22 01:04:42.022359+00	\N
7222a807-0ac0-4c07-a139-ae59848db34b	kmiko28@gmail.com	logout	\N	2025-10-14 23:42:47.102207+00	2025-10-22 01:04:42.022359+00	\N
2a6cd333-18e9-43d4-8b6f-7dd8df3a10de	kmiko28@gmail.com	login	\N	2025-10-14 23:42:51.130027+00	2025-10-22 01:04:42.022359+00	\N
9de7ec07-f2c4-4bcd-8097-cd713f1a5856	kmiko1283@gmail.com	login_denied	\N	2025-10-15 00:25:59.593334+00	2025-10-22 01:04:42.022359+00	\N
ee129cc6-7376-41e0-9a56-a44719001750	kmiko28@gmail.com	login	\N	2025-10-15 00:26:07.158597+00	2025-10-22 01:04:42.022359+00	\N
1a201d01-e1aa-49cb-8b9b-d38d32521954	kmiko28@gmail.com	login	\N	2025-10-15 01:13:48.122988+00	2025-10-22 01:04:42.022359+00	\N
df310c9d-01d3-4d2c-be87-2902c95bb147	kmiko28@gmail.com	login	\N	2025-10-15 01:22:38.034333+00	2025-10-22 01:04:42.022359+00	\N
13af8340-4989-4598-b400-cbc0b9064b08	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-15 01:22:41.020283+00	2025-10-22 01:04:42.022359+00	\N
c0da77b1-36dc-4f16-99ef-5e349ef04829	kmiko28@gmail.com	settings.update.draft	{"hero_title": "fdsa", "updated_at": "2025-10-15T01:22:47.248Z"}	2025-10-15 01:22:48.942783+00	2025-10-22 01:04:42.022359+00	\N
57eb4ad4-b7c3-4849-9d60-a04c2e49a255	unknown	logout	\N	2025-10-18 17:59:07.828964+00	2025-10-22 01:04:42.022359+00	\N
499b427f-b0eb-4a34-9d57-103312de2ba0	unknown	logout	\N	2025-10-18 17:59:07.828456+00	2025-10-22 01:04:42.022359+00	\N
21eeb736-761c-4bd3-8e11-cf5ab65f304b	unknown	logout	\N	2025-10-18 18:09:59.201406+00	2025-10-22 01:04:42.022359+00	\N
5448ad6c-8d62-4a73-8a83-8bc290fae848	unknown	logout	\N	2025-10-18 18:09:59.237563+00	2025-10-22 01:04:42.022359+00	\N
6824a1ef-110b-44ee-952c-e3cd47dcd611	unknown	logout	\N	2025-10-18 18:15:29.992081+00	2025-10-22 01:04:42.022359+00	\N
ccbd6b7d-e1f5-4415-862c-3025522574a7	unknown	logout	\N	2025-10-18 18:15:29.991552+00	2025-10-22 01:04:42.022359+00	\N
6eae1d40-cad3-4643-9b21-fe1ab871b734	kmiko28@gmail.com	login	\N	2025-10-18 20:02:56.153066+00	2025-10-22 01:04:42.022359+00	\N
5e58d7fb-1d19-4abb-b496-ec72645dfeb9	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 20:05:50.783867+00	2025-10-22 01:04:42.022359+00	\N
b5511f19-d027-4b53-8eda-4afcd97cfd15	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 20:29:38.172595+00	2025-10-22 01:04:42.022359+00	\N
b26a0186-7652-41e1-9b38-d17830ed7a01	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 20:29:39.840172+00	2025-10-22 01:04:42.022359+00	\N
673fe58f-c34c-42dd-a57a-6d62e6433efc	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 23:29:08.641787+00	2025-10-22 01:04:42.022359+00	\N
d13fae94-cf4f-41ee-8018-2b0e62b0e635	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 23:29:41.069811+00	2025-10-22 01:04:42.022359+00	\N
15ae0aed-fc98-470c-8609-8462642705e1	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-18 23:39:29.679508+00	2025-10-22 01:04:42.022359+00	\N
33439087-ca9f-4405-932e-45839a9ed0d5	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-19 01:11:42.909709+00	2025-10-22 01:04:42.022359+00	\N
574f9b8c-cbc6-48c7-a3cc-584d3fee5dff	kmiko28@gmail.com	settings.update.draft	{"id": "98cdde56-55da-45cc-b374-4a50ea117f12", "logo_url": null, "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-19T01:11:51.091Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "accent_color": "#FFD700", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": null, "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "background_gradient": "linear-gradient(to right, #000, #1a1a40)", "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "admin_timeout_minutes": 30, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-19 01:11:52.469543+00	2025-10-22 01:04:42.022359+00	\N
f394bec9-05d2-450c-8131-0f10a7379be2	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-19 01:12:02.322615+00	2025-10-22 01:04:42.022359+00	\N
4353ea38-7c38-4d97-b0a5-1fac8c677a2d	kmiko28@gmail.com	login	\N	2025-10-19 01:23:26.840621+00	2025-10-22 01:04:42.022359+00	\N
337e8886-5d1a-4559-bad1-8ec1994c3fc3	kmiko28@gmail.com	logout	\N	2025-10-19 02:52:11.968072+00	2025-10-22 01:04:42.022359+00	\N
9aa48026-2e95-4782-9129-82526cfa4121	kmiko28@gmail.com	login	\N	2025-10-19 02:52:15.185266+00	2025-10-22 01:04:42.022359+00	\N
be883041-e768-4987-868c-3144779ed0b4	kmiko28@gmail.com	login	\N	2025-10-19 03:11:25.99335+00	2025-10-22 01:04:42.022359+00	\N
01b8c311-502f-4aa3-8242-23be61e7d988	kmiko28@gmail.com	login	\N	2025-10-19 11:55:48.748855+00	2025-10-22 01:04:42.022359+00	\N
eb084ac6-ee11-431b-98ae-66a5d9dbe15c	system	settings.pull_live_to_draft	\N	2025-10-19 11:55:51.277453+00	2025-10-22 01:04:42.022359+00	\N
1d6a86b0-fe31-4633-b554-49a2f5d5778a	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funny", "site_title": "Too Funny Productions", "updated_at": "2025-10-19T11:55:53.532Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": null, "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-19 11:55:56.722874+00	2025-10-22 01:04:42.022359+00	\N
d557121a-a2ff-4286-954d-59230dc413f8	system	settings.pull_live_to_draft	\N	2025-10-19 12:43:22.099869+00	2025-10-22 01:04:42.022359+00	\N
6230ad25-90a8-4690-bc4f-9070615b53a7	system	settings.pull_live_to_draft	\N	2025-10-19 12:43:25.204013+00	2025-10-22 01:04:42.022359+00	\N
5dea21c5-d7db-41cd-81ec-5dba38655f11	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnydd", "site_title": "Too Funny Productions", "updated_at": "2025-10-19T12:43:25.775Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": null, "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-19 12:43:28.997097+00	2025-10-22 01:04:42.022359+00	\N
b06a1e36-ae46-4eb1-b560-96f73f4211ec	system	settings.pull_live_to_draft	\N	2025-10-19 12:43:37.884856+00	2025-10-22 01:04:42.022359+00	\N
01cb2c71-3ed1-43f8-b5ad-062b5867d16c	kmiko28@gmail.com	login	\N	2025-10-19 12:44:03.954716+00	2025-10-22 01:04:42.022359+00	\N
350e51c0-f5ed-47cf-91a2-d859263d1242	system	settings.pull_live_to_draft	\N	2025-10-19 12:44:05.609845+00	2025-10-22 01:04:42.022359+00	\N
db387c72-d832-4027-adfc-4af1ccf73533	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "Comedy that's Too Funnyfdsa", "site_title": "Too Funny Productions", "updated_at": "2025-10-19T12:44:14.717Z", "favicon_url": null, "footer_text": "© Too Funny Productions. All rights reserved.", "contactemail": "info@toofunnyproductions.com", "contactphone": "555-555-5555", "footer_links": null, "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": null, "site_keywords": null, "hero_image_url": null, "contact_socials": null, "site_description": null, "featured_video_url": null, "maintenance_enabled": false, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-19 12:44:17.974353+00	2025-10-22 01:04:42.022359+00	\N
4e922394-d42f-4bf2-ae98-2701ef7d519d	system	settings.pull_live_to_draft	\N	2025-10-19 12:44:13.782539+00	2025-10-22 01:04:42.022359+00	\N
4f6787c9-2b26-4bda-b476-8025127b30d3	kmiko28@gmail.com	login	\N	2025-10-19 13:29:32.055069+00	2025-10-22 01:04:42.022359+00	\N
edf674e7-4119-4fe9-b549-ad96cd75779f	kmiko28@gmail.com	login	\N	2025-10-19 19:23:38.852587+00	2025-10-22 01:04:42.022359+00	\N
0f7e9c89-5c07-4f8b-b605-0770a39424ac	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-19 19:23:46.780547+00	2025-10-22 01:04:42.022359+00	\N
81f6732d-721d-44fb-b030-caceec3df814	kmiko28@gmail.com	settings.update.draft	{"logo_url": null, "hero_title": "d", "site_title": null, "updated_at": "2025-10-19T19:23:50.887Z", "favicon_url": null, "footer_text": null, "contactemail": null, "contactphone": null, "footer_links": [], "hero_subtext": null, "published_at": null, "theme_accent": "#FFD700", "site_keywords": null, "hero_image_url": null, "contact_socials": [], "site_description": null, "featured_video_url": null, "maintenance_enabled": null, "maintenance_message": null, "maintenance_timezone": null, "maintenance_daily_end": null, "maintenance_daily_start": null, "maintenance_schedule_enabled": null}	2025-10-19 19:23:51.494373+00	2025-10-22 01:04:42.022359+00	\N
7e5d0e5d-982f-4ca6-a085-2c87d24ab196	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-19 19:24:12.593422+00	2025-10-22 01:04:42.022359+00	\N
e3c991b4-e920-49ce-aa9e-59bf9ed04133	kmiko28@gmail.com	login	\N	2025-10-20 00:53:59.319347+00	2025-10-22 01:04:42.022359+00	\N
0932c33a-1533-4804-b2db-cf2c6be11e5e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 00:54:03.415704+00	2025-10-22 01:04:42.022359+00	\N
5cc7db69-69bb-4a4a-aeeb-92222ade7485	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:23:34.900409+00	2025-10-22 01:04:42.022359+00	\N
f817e455-eef4-4a7a-8fb4-01b2c8be625e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:27:37.473008+00	2025-10-22 01:04:42.022359+00	\N
7761bd8d-d70c-4032-8d17-a7db0d6b296c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:27:39.279855+00	2025-10-22 01:04:42.022359+00	\N
c5157e81-4ead-4c30-b170-b4196d75deb1	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:29:06.633077+00	2025-10-22 01:04:42.022359+00	\N
70849302-7f11-4f09-993d-08289058952f	kmiko28@gmail.com	login	\N	2025-10-20 01:39:05.103237+00	2025-10-22 01:04:42.022359+00	\N
75a36f9f-7dba-4c3e-b4f8-a1de0c039324	kmiko28@gmail.com	login	\N	2025-10-20 01:39:23.981707+00	2025-10-22 01:04:42.022359+00	\N
cd6f428c-a826-49b3-92a4-e6575b079fc2	kmiko28@gmail.com	login	\N	2025-10-20 01:40:23.967626+00	2025-10-22 01:04:42.022359+00	\N
121662f3-7882-435d-9dc2-63b377835a62	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:40:26.22259+00	2025-10-22 01:04:42.022359+00	\N
05257b6d-8d0e-40bb-82b0-d83379779588	kmiko28@gmail.com	login	\N	2025-10-20 01:41:00.245979+00	2025-10-22 01:04:42.022359+00	\N
fe0dfbf3-194f-437e-a37c-f0722eb7559e	unknown	logout	\N	2025-10-20 01:58:21.66379+00	2025-10-22 01:04:42.022359+00	\N
e8697c5a-8eff-4321-a35c-ca832f78ad6f	kmiko28@gmail.com	login	\N	2025-10-20 01:58:38.924838+00	2025-10-22 01:04:42.022359+00	\N
357bdaa9-73e2-47f3-9a91-2f204de558f0	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:59:29.984017+00	2025-10-22 01:04:42.022359+00	\N
f2a8f9ce-4650-4bce-acb2-d9591e423364	kmiko28@gmail.com	login	\N	2025-10-20 01:59:40.703197+00	2025-10-22 01:04:42.022359+00	\N
be6a4bac-2267-43bf-8ea6-3d8077a34106	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 01:59:42.648818+00	2025-10-22 01:04:42.022359+00	\N
5257f662-3fb4-49c9-9898-17f58b4312b8	kmiko28@gmail.com	login	\N	2025-10-20 04:08:05.297724+00	2025-10-22 01:04:42.022359+00	\N
cdb6b6a9-1742-4923-b7a2-fe6d2d5e4f11	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 04:08:09.452129+00	2025-10-22 01:04:42.022359+00	\N
03dd6fe5-2ca3-4b64-a48d-3bd5baebc58b	kmiko28@gmail.com	login	\N	2025-10-20 04:11:09.132888+00	2025-10-22 01:04:42.022359+00	\N
5c48bb3d-9c24-4d71-97bd-2e9a12a2c483	kmiko28@gmail.com	login	\N	2025-10-20 04:11:25.899039+00	2025-10-22 01:04:42.022359+00	\N
613700ba-791a-43e7-baa7-370cbdc57e24	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 04:11:28.292587+00	2025-10-22 01:04:42.022359+00	\N
85afd52d-6ffd-453a-b3c7-8092639f1176	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 04:11:31.022031+00	2025-10-22 01:04:42.022359+00	\N
0fd22c03-311f-4617-a8f0-d3d383637b70	kmiko28@gmail.com	login	\N	2025-10-20 04:18:23.305712+00	2025-10-22 01:04:42.022359+00	\N
173ffc79-4f2c-4908-b4a6-91fa86e108e2	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-20 04:18:46.916763+00	2025-10-22 01:04:42.022359+00	\N
1fd44c41-6e52-493c-b1c6-0a1b71c1b3d2	kmiko28@gmail.com	login	\N	2025-10-22 01:30:58.246524+00	2025-10-22 01:30:55.877+00	\N
a568c304-df10-4b95-a571-443d1f1690db	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 01:31:00.534121+00	2025-10-22 01:30:58.256+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url"]}
7cea8b58-e578-4cb4-8ef4-8ab26d60eb13	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 01:31:00.80637+00	2025-10-22 01:30:58.52+00	{"expires_at": "2025-10-22T01:35:58.353+00:00"}
dab676ed-c186-46d4-8cb4-1e60c5e22b33	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 01:31:41.083747+00	2025-10-22 01:31:38.79+00	{"stage": "draft", "changed": {"session_timeout_minutes": {"after": 5, "before": 30}}, "changedKeys": ["session_timeout_minutes"]}
42a3f171-4c8c-4430-a9d8-4403ac89b662	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 01:31:42.636772+00	2025-10-22 01:31:40.342+00	{"changed": {"session_timeout_minutes": {"after": 5, "before": 30}}, "changedKeys": ["session_timeout_minutes"], "published_at": "2025-10-22T01:31:40.202Z"}
36d64bb9-3fed-496f-8847-7034e4be456e	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 01:31:42.971855+00	2025-10-22 01:31:40.689+00	\N
9548ea5a-4615-4f66-8f84-df61f202aac0	kmiko28@gmail.com	logout	\N	2025-10-22 01:38:53.97929+00	2025-10-22 01:38:51.399+00	\N
adc3c9e9-686d-45ed-b51c-aacc06c773f8	kmiko28@gmail.com	logout	\N	2025-10-22 01:38:54.034444+00	2025-10-22 01:38:51.402+00	\N
a2911820-4967-447d-97a6-339cac36837b	kmiko28@gmail.com	login	\N	2025-10-22 02:28:08.814488+00	2025-10-22 02:28:05.733+00	\N
7ab3fca7-a1b6-48d5-b030-52549ae59faa	kmiko28@gmail.com	login	\N	2025-10-22 02:31:14.186937+00	2025-10-22 02:31:11.696+00	\N
483429c9-6a5c-44cd-be55-055084538712	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:31:18.420717+00	2025-10-22 02:31:15.959+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
5679ace3-1c8b-4ff6-a81f-720dd54f533a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:31:18.780926+00	2025-10-22 02:31:16.347+00	{"expires_at": "2025-10-22T02:36:16.091+00:00"}
5135f1ed-4536-4848-a766-fa7b31d722f3	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:31:35.730351+00	2025-10-22 02:31:33.279+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#989a9a", "before": "#00a8e0"}, "header_bg": {"after": "#a19b9b", "before": "#f00000"}}, "changedKeys": ["theme_bg", "header_bg"]}
3e0c55cb-d745-49d7-8400-adfcf69b6d05	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:31:37.166589+00	2025-10-22 02:31:34.709+00	{"changed": {"theme_bg": {"after": "#989a9a", "before": "#00a8e0"}, "header_bg": {"after": "#a19b9b", "before": "#f00000"}}, "changedKeys": ["theme_bg", "header_bg"], "published_at": "2025-10-22T02:31:34.578Z"}
8cf8d094-ab6d-4fbb-a062-d2adf8bc0be2	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:31:37.536745+00	2025-10-22 02:31:35.089+00	\N
d2697ff7-269d-4879-9886-b78e9ab6e9ec	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:35:03.781026+00	2025-10-22 02:35:01.34+00	{"stage": "draft", "changed": {"theme_accent": {"after": "#f8d92a", "before": "#a88f00"}}, "changedKeys": ["theme_accent"]}
05e72c8f-0a6d-4241-9f70-c252633dda4c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:35:04.750199+00	2025-10-22 02:35:02.301+00	{"changed": {"theme_accent": {"after": "#f8d92a", "before": "#a88f00"}}, "changedKeys": ["theme_accent"], "published_at": "2025-10-22T02:35:02.242Z"}
a2d1d4c7-4bc7-492d-ba8b-ee1d548464ea	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:32:53.130971+00	2025-10-22 02:32:50.686+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
eb155936-e9be-404b-90ff-2c54360700e9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:32:53.399193+00	2025-10-22 02:32:50.957+00	{"expires_at": "2025-10-22T02:37:50.788+00:00"}
bd5766e9-86fb-4545-b739-2b1c03a5c752	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:33:04.81267+00	2025-10-22 02:33:02.376+00	{"stage": "draft", "changed": {"theme_accent": {"after": "#ffd900", "before": "#998200"}}, "changedKeys": ["theme_accent"]}
b33f3b15-7890-46f3-ad31-3a863a269062	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:33:08.022603+00	2025-10-22 02:33:05.592+00	{"changed": {"theme_accent": {"after": "#ffd900", "before": "#998200"}}, "changedKeys": ["theme_accent"], "published_at": "2025-10-22T02:33:05.539Z"}
54461200-bf6a-449d-9d88-34d34a9fdc63	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:33:08.351636+00	2025-10-22 02:33:05.86+00	\N
9212cd87-3907-4be0-94c5-ad3989fb7c63	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:33:15.141794+00	2025-10-22 02:33:12.709+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
158b0768-f1c4-4a42-ad77-d81ceac4c3a4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:33:15.35967+00	2025-10-22 02:33:12.926+00	{"expires_at": "2025-10-22T02:38:12.771+00:00"}
eae10c15-94ab-4b76-a8eb-0f942c6472d6	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:33:35.456219+00	2025-10-22 02:33:33.008+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#010101", "before": "#989a9a"}}, "changedKeys": ["theme_bg"]}
7560678c-288e-40b4-b843-6f79a1a72459	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:33:36.506+00	2025-10-22 02:33:34.055+00	{"changed": {"theme_bg": {"after": "#010101", "before": "#989a9a"}}, "changedKeys": ["theme_bg"], "published_at": "2025-10-22T02:33:33.997Z"}
85abbbe6-600f-4413-9c04-1235c77b4299	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:33:36.81388+00	2025-10-22 02:33:34.344+00	\N
06be5479-4f30-49fc-9096-2cf732a388dc	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:33:50.204844+00	2025-10-22 02:33:47.771+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
f28a196e-5c48-4fa7-a1ed-9d6145b5fdd0	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:33:50.444186+00	2025-10-22 02:33:48.013+00	{"expires_at": "2025-10-22T02:38:47.842+00:00"}
b3fd9fbb-31f1-497a-b61e-a65f4e27cc23	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:34:04.800513+00	2025-10-22 02:34:02.35+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
75ad79f7-6125-4b4d-b093-ee2e39c0c555	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:34:14.835297+00	2025-10-22 02:34:12.384+00	{"stage": "draft", "changed": {"header_bg": {"after": "#4d4d4d", "before": "#a19b9b"}, "theme_accent": {"after": "#a88f00", "before": "#ffd900"}}, "changedKeys": ["theme_accent", "header_bg"]}
0bdfca06-6e69-47bb-ab4e-d9664371e400	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:34:15.864282+00	2025-10-22 02:34:13.418+00	{"changed": {"header_bg": {"after": "#4d4d4d", "before": "#a19b9b"}, "theme_accent": {"after": "#a88f00", "before": "#ffd900"}}, "changedKeys": ["theme_accent", "header_bg"], "published_at": "2025-10-22T02:34:13.355Z"}
268d880c-90a4-4ec4-bbe5-5980651de4fe	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:34:16.166271+00	2025-10-22 02:34:13.716+00	\N
ff622387-5631-421a-a3c1-df9396db447a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:34:17.306096+00	2025-10-22 02:34:14.86+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
6606e1af-71a9-4b28-a66f-73ff7d03a2c7	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:34:17.560092+00	2025-10-22 02:34:15.114+00	{"expires_at": "2025-10-22T02:39:14.93+00:00"}
3850ecd3-4043-4f71-8bdc-b9a76bef7539	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:50:13.878761+00	2025-10-22 02:50:11.388+00	{"expires_at": "2025-10-22T02:55:11.146+00:00"}
003d252b-42e4-4bf5-a224-40f73f6908d9	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:34:59.542788+00	2025-10-22 02:34:57.096+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
d293a52e-c898-401f-b9d2-2ae55a2afdf9	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:35:05.038634+00	2025-10-22 02:35:02.576+00	\N
78fd4566-9a8c-43da-bbd8-474353471fbc	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:36:12.396466+00	2025-10-22 02:36:09.914+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
d143a88f-c072-4f0e-8cbe-bdabc82f47ea	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:36:12.679918+00	2025-10-22 02:36:10.209+00	{"expires_at": "2025-10-22T02:41:10.027+00:00"}
53b74634-a24b-46c4-8f2c-89ab7ef7d6b8	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:36:26.138675+00	2025-10-22 02:36:23.682+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#7f5353", "before": "#010101"}}, "changedKeys": ["theme_bg"]}
4c2222dd-7f5d-4f6c-935b-5c64cba3917c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:36:27.159232+00	2025-10-22 02:36:24.708+00	{"changed": {"theme_bg": {"after": "#7f5353", "before": "#010101"}}, "changedKeys": ["theme_bg"], "published_at": "2025-10-22T02:36:24.629Z"}
ffbed097-97da-4d4b-9d8f-73334fd09b5b	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:36:27.472927+00	2025-10-22 02:36:25.025+00	\N
ef4c859a-2e70-4750-94c7-b1c1ca44531e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:36:53.91591+00	2025-10-22 02:36:51.467+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
191430f6-f933-496a-9e37-e180c85ed494	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:36:54.156841+00	2025-10-22 02:36:51.7+00	{"expires_at": "2025-10-22T02:41:51.548+00:00"}
7acb3939-c6e9-4d8c-9b61-96c10d4f959b	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:37:11.628189+00	2025-10-22 02:37:09.19+00	{"stage": "draft", "changed": {"who_image_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761094930372_PartyTime.jpg"}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760047204508_hoodie.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}}, "changedKeys": ["hero_image_url", "who_image_url"]}
8fa961a7-06e9-4ed4-9493-5f325a888870	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:37:12.576357+00	2025-10-22 02:37:10.126+00	{"changed": {"who_image_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761094930372_PartyTime.jpg"}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760047204508_hoodie.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}}, "changedKeys": ["hero_image_url", "who_image_url"], "published_at": "2025-10-22T02:37:10.064Z"}
8bf84f22-6a22-42f2-a79c-987138b9a96c	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:37:12.826398+00	2025-10-22 02:37:10.339+00	\N
84b9671f-568f-48df-9493-2ad09ffaa5d0	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:37:26.503923+00	2025-10-22 02:37:24.059+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
238cf6e1-efd3-4a0f-a498-0d453bb29b8c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:37:26.73607+00	2025-10-22 02:37:24.282+00	{"expires_at": "2025-10-22T02:42:24.122+00:00"}
2db050bf-94c1-417d-bfad-be6e1257c15b	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:37:55.428038+00	2025-10-22 02:37:52.973+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg", "before": null}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png", "before": null}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760047204508_hoodie.jpg"}}, "changedKeys": ["logo_url", "favicon_url", "hero_image_url"]}
f0bb5285-a909-4caa-9f2d-99dc1fafcbb7	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:37:56.722068+00	2025-10-22 02:37:54.274+00	\N
e9b8fbb6-032b-4812-a791-a14003309c21	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:51:13.882767+00	2025-10-22 02:51:11.359+00	{"expires_at": "2025-10-22T02:56:11.146+00:00"}
89ebe402-b5aa-400e-b690-b386b225c721	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:35:46.693878+00	2025-10-25 01:35:45.16+00	{"expires_at": "2025-10-25T01:40:44.879+00:00"}
feab8fc8-1315-4026-9535-8a7c70d1867d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:39:46.696915+00	2025-10-25 01:39:45.135+00	{"expires_at": "2025-10-25T01:44:44.856+00:00"}
265d04f2-7c39-4cec-a077-4932641d561d	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:37:56.477578+00	2025-10-22 02:37:54.021+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg", "before": null}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png", "before": null}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760047204508_hoodie.jpg"}}, "changedKeys": ["logo_url", "favicon_url", "hero_image_url"], "published_at": "2025-10-22T02:37:53.970Z"}
0f84a798-dbba-48af-a295-b8ae37b47cbf	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:38:31.264746+00	2025-10-22 02:38:28.804+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
634529f8-3da0-490c-9aec-f9ebd33eca08	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:38:31.494156+00	2025-10-22 02:38:29.045+00	{"expires_at": "2025-10-22T02:43:28.887+00:00"}
4187055c-301d-4fc5-a68c-7e6e116aea00	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:39:01.558932+00	2025-10-22 02:38:59.111+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": []}}, "changedKeys": ["about_team"]}
e740eb88-bbbe-4ed7-895a-5430cbca75e9	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:39:03.263977+00	2025-10-22 02:39:00.814+00	{"changed": {"about_team": {"after": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": []}}, "changedKeys": ["about_team"], "published_at": "2025-10-22T02:39:00.756Z"}
1b0b63b4-a798-42ea-bbb4-7dde5b6066b0	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:39:03.478371+00	2025-10-22 02:39:01.031+00	\N
34bad268-8ac0-4c66-a56a-68d5e4b87bac	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:43:44.392154+00	2025-10-22 02:43:41.917+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
d9b1bee7-198e-4442-af92-f65d6f092f95	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:43:44.651891+00	2025-10-22 02:43:42.181+00	{"expires_at": "2025-10-22T02:48:42.022+00:00"}
59046c92-413e-4d58-bcc9-fd3bcc6ef08d	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:44:01.066009+00	2025-10-22 02:43:58.589+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#878787", "before": "#7f5353"}, "header_bg": {"after": "#000000", "before": "#4d4d4d"}}, "changedKeys": ["theme_bg", "header_bg"]}
8e52c9b0-1e1c-468d-8504-c14f6cf1c4c5	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 02:44:02.028254+00	2025-10-22 02:43:59.549+00	{"changed": {"theme_bg": {"after": "#878787", "before": "#7f5353"}, "header_bg": {"after": "#000000", "before": "#4d4d4d"}}, "changedKeys": ["theme_bg", "header_bg"], "published_at": "2025-10-22T02:43:59.442Z"}
82f2c915-ab95-4633-b148-c222b998dad0	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 02:44:02.326529+00	2025-10-22 02:43:59.848+00	\N
b3032afb-12f0-4b68-8b20-36469bb1d54b	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 02:45:13.255652+00	2025-10-22 02:45:10.755+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
856f1ee0-e5ec-4c67-a2ff-5fc9ac199e6d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:45:13.545607+00	2025-10-22 02:45:11.037+00	{"expires_at": "2025-10-22T02:50:10.855+00:00"}
8952517d-93cc-4fc8-b080-973098f30cbd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:46:13.950106+00	2025-10-22 02:46:11.474+00	{"expires_at": "2025-10-22T02:51:11.167+00:00"}
54051e8c-b843-4884-9b22-eb394bb3d7bb	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:46:24.19558+00	2025-10-22 02:46:21.71+00	{"stage": "draft", "changed": {"who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "who_title": {"after": "Who We Are", "before": null}, "hero_subtext": {"after": "Original sketch, live shows, and shamelessly fun chaos.", "before": null}}, "changedKeys": ["hero_subtext", "who_title", "who_body"]}
db577037-6b92-4d7e-8468-9832673bb98e	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 02:46:37.844351+00	2025-10-22 02:46:35.357+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [], "before": [{"url": "https://www.google.com", "label": "test"}]}}, "changedKeys": ["admin_quick_links"]}
a8d1b5a4-86be-4ddd-8004-f9b78f914967	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:47:13.841658+00	2025-10-22 02:47:11.362+00	{"expires_at": "2025-10-22T02:52:11.154+00:00"}
c6bb3193-c1dc-4db8-bc3c-b65080ddfbcb	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:48:13.816819+00	2025-10-22 02:48:11.344+00	{"expires_at": "2025-10-22T02:53:11.156+00:00"}
b0e35bac-7e81-4035-ae46-6dd98cbdadff	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 02:49:13.832073+00	2025-10-22 02:49:11.357+00	{"expires_at": "2025-10-22T02:54:11.157+00:00"}
f4615a13-60f6-4cae-aac1-2a096771584c	kmiko28@gmail.com	login	\N	2025-10-22 03:20:53.113411+00	2025-10-22 03:20:50.43+00	\N
fbcba4d4-8294-405b-abc2-d8d1993b89df	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:21:00.260344+00	2025-10-22 03:20:57.678+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
3c6bc796-16a1-4949-a865-5a9ec78dc3c5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:21:00.709364+00	2025-10-22 03:20:58.135+00	{"expires_at": "2025-10-22T03:25:57.815+00:00"}
11133a3b-09bb-4f7c-a175-d6d6f0ee54e5	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:21:42.027955+00	2025-10-22 03:21:39.44+00	{"stage": "draft", "changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}], "before": []}}, "changedKeys": ["media_sections"]}
a7adf22e-c640-492b-a432-f503a58b52d5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:22:01.153729+00	2025-10-22 03:21:58.521+00	{"expires_at": "2025-10-22T03:26:58.254+00:00"}
e74a01c5-7a59-4a42-ad99-de5653e31f2b	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:22:52.581829+00	2025-10-22 03:22:49.983+00	{"changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}], "before": []}}, "changedKeys": ["media_sections"], "published_at": "2025-10-22T03:22:49.893Z"}
3a6d2efe-2abf-4a05-8074-147cffb4a34c	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:22:52.926432+00	2025-10-22 03:22:50.36+00	\N
bcfb513d-14e6-4836-a73d-d5dd38db570c	kmiko28@gmail.com	logout	\N	2025-10-22 03:29:07.673173+00	2025-10-22 03:29:04.78+00	\N
c8d2f6f6-1fc3-4d61-91e1-ce85ab93d37e	kmiko28@gmail.com	logout	\N	2025-10-22 03:29:07.688861+00	2025-10-22 03:29:04.783+00	\N
94321866-27c7-4c68-931b-913e0d0e47d5	kmiko28@gmail.com	login	\N	2025-10-22 03:40:14.667561+00	2025-10-22 03:40:11.972+00	\N
e0194e75-4728-4859-acaa-7b1ee447886e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:40:20.857426+00	2025-10-22 03:40:18.227+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
74ed898c-c3e2-4006-bbef-c39bbde9e9e2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:40:21.133029+00	2025-10-22 03:40:18.499+00	{"expires_at": "2025-10-22T03:45:18.31+00:00"}
ab6d51d3-58be-46c8-bc1e-41fe696c13cd	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:40:35.86899+00	2025-10-22 03:40:33.259+00	{"stage": "draft", "changed": {"who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "who_title": {"after": "Who We Are", "before": null}, "hero_subtext": {"after": "Original sketch, live shows, and shamelessly fun chaos.", "before": null}}, "changedKeys": ["hero_subtext", "who_title", "who_body"]}
753396b9-fc9a-46bc-bc51-55be3fe15d33	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:41:21.513769+00	2025-10-22 03:41:18.873+00	{"expires_at": "2025-10-22T03:46:18.608+00:00"}
4f39de25-7783-4665-8987-4421527e2ef4	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:42:07.609092+00	2025-10-22 03:42:04.995+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg", "before": null}, "theme_bg": {"after": "#878787", "before": "linear-gradient(to right, #000, #1a1a40)"}, "who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "who_title": {"after": "Who We Are", "before": null}, "about_team": {"after": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": []}, "hero_title": {"after": "Comedy That's Too Funny", "before": "d"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png", "before": null}, "hero_subtext": {"after": "Original sketch, live shows, and shamelessly fun chaos.", "before": null}, "theme_accent": {"after": "#CED043", "before": "#FFD700"}, "who_image_url": {"after": "", "before": null}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": null}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}], "before": []}, "events_upcoming": {"after": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}], "before": []}, "admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}], "before": []}, "featured_video_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "before": null}, "session_timeout_minutes": {"after": 5, "before": 30}}, "changedKeys": ["logo_url", "favicon_url", "hero_title", "hero_subtext", "hero_image_url", "featured_video_url", "theme_accent", "theme_bg", "session_timeout_minutes", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"]}
59f422c4-053a-4a9d-92ce-3485ce90d12d	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:42:09.11852+00	2025-10-22 03:42:06.501+00	{"changed": {"who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "who_title": {"after": "Who We Are", "before": null}, "hero_subtext": {"after": "Original sketch, live shows, and shamelessly fun chaos.", "before": null}, "theme_accent": {"after": "#CED043", "before": "#f8d92a"}, "admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}], "before": [{"url": "https://www.google.com", "label": "test"}]}}, "changedKeys": ["hero_subtext", "theme_accent", "who_title", "who_body", "admin_quick_links"], "published_at": "2025-10-22T03:42:06.051Z"}
b500ba37-b0e0-450d-9d09-82862517dc48	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:42:09.402845+00	2025-10-22 03:42:06.755+00	\N
db78aee9-27dc-4c76-aa66-b0c17d1a5f6a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:42:17.41742+00	2025-10-22 03:42:14.803+00	{"expires_at": "2025-10-22T03:47:14.643+00:00"}
72647a84-001b-423e-aaee-f3b853b542ce	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:42:25.890891+00	2025-10-22 03:42:23.275+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#740202", "before": "#878787"}}, "changedKeys": ["theme_bg"]}
640cfc61-8b67-4d07-a41d-64795750972c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:42:26.716027+00	2025-10-22 03:42:24.077+00	{"changed": {"theme_bg": {"after": "#740202", "before": "#878787"}}, "changedKeys": ["theme_bg"], "published_at": "2025-10-22T03:42:24.011Z"}
c829951e-ce68-4bba-bf97-bee7e1cf39bf	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:42:57.628229+00	2025-10-22 03:42:55.01+00	\N
95b4e83b-900c-4a64-88c4-4d1b19c2ec59	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:42:17.16825+00	2025-10-22 03:42:14.546+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
84d632a1-fd0a-4be6-add2-6c8add741b43	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:42:26.976297+00	2025-10-22 03:42:24.361+00	\N
8464ea8c-ca14-46c3-bcfe-db4664123e7a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:42:40.736469+00	2025-10-22 03:42:38.102+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
0abb07ea-1e78-4bf0-822a-4deb717fb246	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:42:40.989002+00	2025-10-22 03:42:38.358+00	{"expires_at": "2025-10-22T03:47:38.206+00:00"}
5bf34d4d-52bc-4ab6-958d-9ed943bc31d4	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:42:56.057545+00	2025-10-22 03:42:53.424+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#FD641A", "before": "#740202"}, "footer_bg": {"after": "#DF0101", "before": "#000000"}, "header_bg": {"after": "#DF0101", "before": "#000000"}, "theme_accent": {"after": "#FD87C6", "before": "#CED043"}}, "changedKeys": ["theme_accent", "theme_bg", "header_bg", "footer_bg"]}
67adc301-639a-434e-8876-89b93d781fb5	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:42:57.33709+00	2025-10-22 03:42:54.714+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg"}, "theme_bg": {"after": "linear-gradient(to right, #000, #1a1a40)", "before": "#740202"}, "who_body": {"after": null, "before": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv."}, "who_title": {"after": null, "before": "Who We Are"}, "about_team": {"after": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's TOO FUNNY", "before": "Comedy That's Too Funny"}, "footer_links": {"after": [{"url": "www.google.com", "label": "Google"}], "before": []}, "theme_accent": {"after": "#FFD700", "before": "#CED043"}, "who_image_url": {"after": null, "before": ""}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}]}, "events_upcoming": {"after": [], "before": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}]}, "admin_quick_links": {"after": [], "before": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}]}}, "changedKeys": ["hero_title", "footer_links", "logo_url", "theme_accent", "hero_image_url", "theme_bg", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"], "published_at": "2025-10-22T03:42:54.630Z"}
76a770f9-d547-4a49-b0c0-e246f9338ec4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:43:31.279101+00	2025-10-22 03:43:28.641+00	{"expires_at": "2025-10-22T03:48:28.47+00:00"}
dd88c102-b92f-4105-9246-97eecf0ae4d8	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:43:45.522599+00	2025-10-22 03:43:42.896+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#FD641A", "before": "#878787"}, "footer_bg": {"after": "#DF0101", "before": "#000000"}, "header_bg": {"after": "#DF0101", "before": "#000000"}, "theme_accent": {"after": "#FD87C6", "before": "#f8d92a"}}, "changedKeys": ["theme_accent", "theme_bg", "header_bg", "footer_bg"]}
37d603d5-c8b0-4d76-b59e-823910d24dbc	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:43:46.772971+00	2025-10-22 03:43:44.144+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "theme_bg": {"after": "#FD641A", "before": "linear-gradient(to right, #000, #1a1a40)"}, "who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "footer_bg": {"after": "#DF0101", "before": "#000000"}, "header_bg": {"after": "#DF0101", "before": "#000000"}, "who_title": {"after": "Who We Are", "before": null}, "about_team": {"after": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's Too Funny", "before": "Comedy That's TOO FUNNY"}, "footer_links": {"after": [], "before": [{"url": "www.google.com", "label": "Google"}]}, "theme_accent": {"after": "#FD87C6", "before": "#FFD700"}, "who_image_url": {"after": "", "before": null}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}]}, "events_upcoming": {"after": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}], "before": []}, "admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}], "before": []}}, "changedKeys": ["hero_title", "footer_links", "logo_url", "theme_accent", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"], "published_at": "2025-10-22T03:43:44.087Z"}
dba83d75-de47-438f-bd92-8e91bce0f31b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:43:55.25331+00	2025-10-22 03:43:52.632+00	{"expires_at": "2025-10-22T03:48:52.492+00:00"}
d7a688fe-01c1-46a2-8ea7-850f31f7d08b	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:52:09.090503+00	2025-10-22 03:52:06.419+00	{"changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}, {"items": [{"url": "", "type": "video", "title": ""}], "title": "New Section 2"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}]}}, "changedKeys": ["media_sections"], "published_at": "2025-10-22T03:52:06.218Z"}
83ea373b-9c71-4fe1-b52d-606129ba44df	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:44:46.502221+00	2025-10-25 00:44:45.108+00	{"expires_at": "2025-10-25T00:49:44.855+00:00"}
08f6a913-3863-4376-8330-ee896827335b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:36:46.725275+00	2025-10-25 01:36:45.165+00	{"expires_at": "2025-10-25T01:41:44.848+00:00"}
2051d18f-5192-4e27-814d-1b5c1ad36724	kmiko28@gmail.com	login	\N	2025-10-26 01:08:33.536165+00	2025-10-26 01:08:31.909+00	\N
bfa197c8-b700-4c3a-bd33-920ccc6d362a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:43:30.991019+00	2025-10-22 03:43:28.356+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
6e77ba04-c55f-421a-b338-2f0ebdf7ce89	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:43:47.039661+00	2025-10-22 03:43:44.405+00	\N
9ae62c05-39f9-451b-94c3-8113fd5b8ab8	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:43:55.019308+00	2025-10-22 03:43:52.392+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
a8f8b500-5f5c-4a91-a176-af39c867c898	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:44:01.108437+00	2025-10-22 03:43:58.482+00	\N
413315a5-d9da-42e1-8a6b-cfdd725c1228	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:44:21.241603+00	2025-10-22 03:44:18.622+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
1c8fc4e5-7ba2-47a8-9c2a-ceebdee8416c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:44:58.712557+00	2025-10-22 03:44:56.093+00	{"expires_at": "2025-10-22T03:49:55.957+00:00"}
56bff983-4208-468c-be53-fd7bc4354d8f	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:45:18.93372+00	2025-10-22 03:45:16.308+00	{"stage": "draft", "changed": {"theme_bg": {"after": "#542C82", "before": "#FD641A"}, "footer_bg": {"after": "#0A0A0D", "before": "#DF0101"}, "header_bg": {"after": "#0A0A0D", "before": "#DF0101"}, "theme_accent": {"after": "#E5841A", "before": "#FD87C6"}}, "changedKeys": ["theme_accent", "theme_bg", "header_bg", "footer_bg"]}
9580dbfa-2bef-4f8e-8f6f-8c800ea22c9c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:45:20.062337+00	2025-10-22 03:45:17.437+00	{"changed": {"theme_bg": {"after": "#542C82", "before": "#FD641A"}, "footer_bg": {"after": "#0A0A0D", "before": "#DF0101"}, "header_bg": {"after": "#0A0A0D", "before": "#DF0101"}, "theme_accent": {"after": "#E5841A", "before": "#FD87C6"}}, "changedKeys": ["theme_accent", "theme_bg", "header_bg", "footer_bg"], "published_at": "2025-10-22T03:45:17.368Z"}
15829dd6-aa45-49f9-ba62-4e581f5b28fb	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:44:00.836377+00	2025-10-22 03:43:58.207+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg"}, "theme_bg": {"after": "linear-gradient(to right, #000, #1a1a40)", "before": "#FD641A"}, "who_body": {"after": null, "before": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv."}, "footer_bg": {"after": "#000000", "before": "#DF0101"}, "header_bg": {"after": "#000000", "before": "#DF0101"}, "who_title": {"after": null, "before": "Who We Are"}, "about_team": {"after": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's TOO FUNNY", "before": "Comedy That's Too Funny"}, "footer_links": {"after": [{"url": "www.google.com", "label": "Google"}], "before": []}, "theme_accent": {"after": "#FFD700", "before": "#FD87C6"}, "who_image_url": {"after": null, "before": ""}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}]}, "events_upcoming": {"after": [], "before": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}]}, "admin_quick_links": {"after": [], "before": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}]}}, "changedKeys": ["hero_title", "footer_links", "logo_url", "theme_accent", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"], "published_at": "2025-10-22T03:43:58.136Z"}
ab9b8ac1-8f79-45e5-8a77-e9411073c791	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:44:21.434753+00	2025-10-22 03:44:18.816+00	{"expires_at": "2025-10-22T03:49:18.69+00:00"}
fc1c9550-ac12-4337-a3fa-e15d488c276b	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:44:42.976105+00	2025-10-22 03:44:40.358+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}], "before": [{"url": "https://www.google.com", "label": "test"}]}}, "changedKeys": ["admin_quick_links"]}
8d882c16-e281-42fb-a5ec-bb16cb836a30	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 03:44:45.158317+00	2025-10-22 03:44:42.535+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "theme_bg": {"after": "#FD641A", "before": "linear-gradient(to right, #000, #1a1a40)"}, "who_body": {"after": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv.", "before": null}, "footer_bg": {"after": "#DF0101", "before": "#000000"}, "header_bg": {"after": "#DF0101", "before": "#000000"}, "who_title": {"after": "Who We Are", "before": null}, "about_team": {"after": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's Too Funny", "before": "Comedy That's TOO FUNNY"}, "footer_links": {"after": [], "before": [{"url": "www.google.com", "label": "Google"}]}, "theme_accent": {"after": "#FD87C6", "before": "#FFD700"}, "who_image_url": {"after": "", "before": null}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}]}, "events_upcoming": {"after": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}], "before": []}, "admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}], "before": []}}, "changedKeys": ["hero_title", "footer_links", "logo_url", "theme_accent", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"], "published_at": "2025-10-22T03:44:42.481Z"}
59b87c36-af5f-4301-9ee4-68c15edc9883	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:44:45.461525+00	2025-10-22 03:44:42.777+00	\N
90e6d16b-2449-4106-834e-67f2434ecaa7	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:44:58.496415+00	2025-10-22 03:44:55.873+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
db3937aa-137a-4c29-a525-57b919dc4076	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:45:20.302803+00	2025-10-22 03:45:17.681+00	\N
f5006363-87ec-4243-b301-9637ec892883	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 03:46:52.768483+00	2025-10-22 03:46:50.129+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
128de769-ebed-4cb6-9d70-349b94c41dc3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 03:46:53.021416+00	2025-10-22 03:46:50.366+00	{"expires_at": "2025-10-22T03:51:50.218+00:00"}
6cf6ccdd-fd14-40c1-bae9-c7f5dbbe79f7	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 03:46:55.552405+00	2025-10-22 03:46:52.909+00	\N
751430ce-3091-4b48-8de9-39facaceafee	kmiko28@gmail.com	settings.version.delete	\N	2025-10-22 03:47:00.354983+00	2025-10-22 03:46:57.699+00	{"label": null, "stage": "draft", "versionId": "0368050e-01fd-4617-9439-ad3f843e1e89"}
f2f180b7-1079-4e82-97a9-cb6fed5e321a	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 03:52:07.854388+00	2025-10-22 03:52:05.18+00	{"stage": "draft", "changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}, {"items": [{"url": "", "type": "video", "title": ""}], "title": "New Section 2"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}]}}, "changedKeys": ["media_sections"]}
14066029-f404-4f2b-be10-30e61167f6bf	kmiko28@gmail.com	logout	\N	2025-10-22 03:58:20.361592+00	2025-10-22 03:58:17.576+00	\N
932ede91-6eaf-42b6-8765-3a2a34e9a73b	kmiko28@gmail.com	logout	\N	2025-10-22 03:58:20.440437+00	2025-10-22 03:58:17.573+00	\N
5e254d31-668e-4229-bdb6-fe9324996411	unknown	logout	\N	2025-10-22 04:05:43.203807+00	2025-10-22 04:05:40.237+00	\N
144b27e0-136c-4dee-8658-0a2ffca27c0f	unknown	logout	\N	2025-10-22 04:05:43.203825+00	2025-10-22 04:05:40.24+00	\N
a7d18831-c37e-4e8d-abb7-4561402f61cd	kmiko28@gmail.com	login	\N	2025-10-22 04:48:48.044867+00	2025-10-22 04:48:45.213+00	\N
355fe1b6-ba8c-4a12-a86b-df1dde4cba03	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:45:46.599768+00	2025-10-25 00:45:45.208+00	{"expires_at": "2025-10-25T00:50:44.84+00:00"}
8e5ec032-cd22-4767-af58-2fabcf715259	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:37:46.695783+00	2025-10-25 01:37:45.152+00	{"expires_at": "2025-10-25T01:42:44.85+00:00"}
c54ffb0e-379e-4f8e-806c-56731bcbd261	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 04:48:54.301585+00	2025-10-22 04:48:51.492+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
0f03f96e-665e-4adf-b939-b84a690a8e60	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 04:48:54.604252+00	2025-10-22 04:48:51.812+00	{"expires_at": "2025-10-22T04:53:51.589+00:00"}
9f97ef90-d5c4-4f61-9b61-cca984271475	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 04:49:42.383593+00	2025-10-22 04:49:39.523+00	\N
799ee077-c631-466d-a4a1-36c418137891	kmiko28@gmail.com	login	\N	2025-10-22 05:07:42.495365+00	2025-10-22 05:07:39.617+00	\N
93d2c74c-45c9-42b2-aaf1-543773e02eb3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 05:09:42.553296+00	2025-10-22 05:09:39.669+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
916f205c-3fb4-491a-8f95-e69e89002b88	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:09:42.776132+00	2025-10-22 05:09:39.933+00	{"expires_at": "2025-10-22T05:14:39.787+00:00"}
75858a2c-1f9f-4b86-b804-768241402fd5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:10:43.132931+00	2025-10-22 05:10:40.257+00	{"expires_at": "2025-10-22T05:15:40.007+00:00"}
56a2cc2f-f4a9-46dd-a7b4-d97b29273eb4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:11:43.04562+00	2025-10-22 05:11:40.185+00	{"expires_at": "2025-10-22T05:16:39.998+00:00"}
e11f1e5e-5e7c-4838-8711-121500f46da2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:12:43.070133+00	2025-10-22 05:12:40.2+00	{"expires_at": "2025-10-22T05:17:39.998+00:00"}
99effa40-a012-424b-899a-85420d370770	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 05:13:28.181604+00	2025-10-22 05:13:25.312+00	{"stage": "draft", "changed": {"contactemail": {"after": "email@email.com", "before": null}, "contactphone": {"after": "123-456-7890", "before": null}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}, {"items": [{"url": "", "type": "video", "title": ""}], "title": "New Section 2"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}, {"items": [{"url": "", "type": "video", "title": ""}], "title": "New Section 2"}]}, "contact_socials": {"after": {"tiktok": "TT", "twitter": "X", "youtube": "YT", "facebook": "FB", "instagram": "IG"}, "before": []}}, "changedKeys": ["contactemail", "contactphone", "contact_socials", "media_sections"]}
c08a3818-1fb9-430e-b3d0-eb8251be9438	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 05:13:29.414223+00	2025-10-22 05:13:26.554+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg"}, "theme_bg": {"after": "linear-gradient(to right, #000, #1a1a40)", "before": "#542C82"}, "who_body": {"after": null, "before": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv."}, "footer_bg": {"after": "#000000", "before": "#0A0A0D"}, "header_bg": {"after": "#000000", "before": "#0A0A0D"}, "who_title": {"after": null, "before": "Who We Are"}, "about_team": {"after": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's TOO FUNNY", "before": "Comedy That's Too Funny"}, "footer_links": {"after": [{"url": "www.google.com", "label": "Google"}], "before": []}, "theme_accent": {"after": "#FFD700", "before": "#E5841A"}, "who_image_url": {"after": null, "before": ""}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}, {"items": [{"url": "", "type": "video", "title": ""}], "title": "New Section 2"}]}, "events_upcoming": {"after": [], "before": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}]}, "admin_quick_links": {"after": [], "before": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}]}}, "changedKeys": ["hero_title", "footer_links", "logo_url", "theme_accent", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "who_title", "who_body", "about_team", "events_upcoming", "media_sections", "admin_quick_links", "who_image_url"], "published_at": "2025-10-22T05:13:26.483Z"}
21476f39-6c32-4554-9a58-8353438e0e65	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 05:13:29.663344+00	2025-10-22 05:13:26.803+00	\N
f96910f4-a50c-4031-a0aa-26858b62f0f7	kmiko28@gmail.com	logout	\N	2025-10-22 05:30:50.192773+00	2025-10-22 05:30:47.063+00	\N
b1094e47-24b6-4bc4-ad0e-f122767fb83b	kmiko28@gmail.com	logout	\N	2025-10-22 05:30:50.190091+00	2025-10-22 05:30:47.061+00	\N
725d453f-12e8-4e26-b85a-09f522da7758	unknown	logout	\N	2025-10-22 05:31:08.389951+00	2025-10-22 05:31:05.437+00	\N
5fd15313-cfd9-40b7-8f8c-ef5711fc4272	unknown	logout	\N	2025-10-22 05:31:08.418132+00	2025-10-22 05:31:05.435+00	\N
700364d1-7b11-49ec-aab2-6b1d6ef3e56d	kmiko28@gmail.com	login	\N	2025-10-22 05:41:53.379729+00	2025-10-22 05:41:50.414+00	\N
33c565d8-5672-4c61-81e2-80637e905f4f	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-22 05:42:02.900806+00	2025-10-22 05:41:59.97+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
a7a03a54-531c-4778-9ecb-dd513161e851	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:42:03.118836+00	2025-10-22 05:42:00.18+00	{"expires_at": "2025-10-22T05:47:00.05+00:00"}
e855129c-d9bf-442e-bca3-da455d24f8c6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-22 05:43:03.476827+00	2025-10-22 05:43:00.499+00	{"expires_at": "2025-10-22T05:48:00.269+00:00"}
dc8fdb0b-188e-4576-88ad-318313ef2cf1	kmiko28@gmail.com	settings.lock.release	\N	2025-10-22 05:43:09.776248+00	2025-10-22 05:43:06.819+00	\N
d8caa381-4383-4b9f-b92c-5b59167a0682	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:46:46.511306+00	2025-10-25 00:46:45.103+00	{"expires_at": "2025-10-25T00:51:44.825+00:00"}
64688d43-871a-4807-b9c2-25f3d16bbb0a	kmiko28@gmail.com	login	\N	2025-10-26 01:10:09.581175+00	2025-10-26 01:10:07.915+00	\N
41a32c4a-1793-4d56-a44e-70bb275d3c51	kmiko28@gmail.com	settings.update.draft	\N	2025-10-22 05:45:41.031162+00	2025-10-22 05:45:38.06+00	{"stage": "draft", "changed": {"events_past": {"after": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "before": []}, "contact_socials": {"after": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "before": []}}, "changedKeys": ["contact_socials", "events_past"]}
c3668a2c-5ea3-46ea-85c3-6a3e72752a34	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-22 05:45:42.579562+00	2025-10-22 05:45:39.606+00	{"changed": {"events_past": {"after": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "before": []}, "contact_socials": {"after": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "before": []}}, "changedKeys": ["contact_socials", "events_past"], "published_at": "2025-10-22T05:45:39.434Z"}
f268e6ef-1efe-4854-a603-c0ad4c226956	kmiko28@gmail.com	login	\N	2025-10-24 17:50:21.392883+00	2025-10-24 17:50:20.997+00	\N
99080d78-ac47-460f-a0a5-ce7e517b4ed3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 17:50:28.010756+00	2025-10-24 17:50:27.69+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
6f7d5da4-9b47-4f39-a90a-720b691e9227	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 17:50:28.533921+00	2025-10-24 17:50:28.213+00	{"expires_at": "2025-10-24T17:55:28.025+00:00"}
57b2bb39-711a-4e7c-99c5-c47368026648	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 17:50:55.717744+00	2025-10-24 17:50:55.364+00	{"stage": "draft", "changed": {"footer_links": {"after": [], "before": [{"url": "www.google.com", "label": "Google"}]}}, "changedKeys": ["footer_links"]}
64d250d4-577f-4e93-be5f-6dfd96e1e269	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 17:50:56.943612+00	2025-10-24 17:50:56.624+00	{"changed": {"footer_links": {"after": [], "before": [{"url": "www.google.com", "label": "Google"}]}}, "changedKeys": ["footer_links"], "published_at": "2025-10-24T17:50:56.512Z"}
3cec98da-439b-4e64-9e73-2f619a030bed	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 17:50:57.458685+00	2025-10-24 17:50:57.14+00	\N
cbde4fcd-eebc-4dc2-bb7f-453d235f6848	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 18:01:42.178476+00	2025-10-24 18:01:41.794+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
d3c83eb8-2961-4e64-8e0c-26531836ea95	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 18:01:42.667183+00	2025-10-24 18:01:42.304+00	{"expires_at": "2025-10-24T18:06:42.026+00:00"}
4f5f1904-d4a0-4aa0-a654-98e80c8c29b4	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 18:02:40.906707+00	2025-10-24 18:02:40.515+00	{"stage": "draft", "changed": {"contactemail": {"after": "info@toofunnyproductions.com", "before": null}}, "changedKeys": ["contactemail"]}
72a6cb24-a0d9-4121-bdd9-ac2199916f25	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 18:02:41.823175+00	2025-10-24 18:02:41.453+00	{"changed": {"contactemail": {"after": "info@toofunnyproductions.com", "before": null}}, "changedKeys": ["contactemail"], "published_at": "2025-10-24T18:02:41.297Z"}
02e6caad-9b1c-4877-9acc-b726eef29c78	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 18:02:42.397029+00	2025-10-24 18:02:42.033+00	\N
8b5062ae-0a07-4d08-a769-7e30e24ffb05	kmiko28@gmail.com	logout	\N	2025-10-24 18:09:52.88556+00	2025-10-24 18:09:52.527+00	\N
b2c7eaf7-7553-4597-97ed-e7057e8143ab	kmiko28@gmail.com	login	\N	2025-10-24 18:22:25.01826+00	2025-10-24 18:22:24.123+00	\N
8ea9b2de-3246-4b84-90df-beb41ca508d1	kmiko28@gmail.com	logout	\N	2025-10-24 18:28:38.158942+00	2025-10-24 18:28:37.546+00	\N
6143d408-dfa3-478e-aad1-43ff5c02c048	kmiko28@gmail.com	login	\N	2025-10-24 19:32:03.168171+00	2025-10-24 19:32:02.214+00	\N
f372a8c8-e94c-43a9-b349-730c3e69c118	kmiko28@gmail.com	login	\N	2025-10-24 19:55:45.151712+00	2025-10-24 19:55:44.457+00	\N
efc84aed-bd11-49e2-90f9-c8e77eef9eb2	kmiko28@gmail.com	login	\N	2025-10-24 20:00:42.654986+00	2025-10-24 20:00:41.522+00	\N
fba0c7e5-d170-4748-8bcc-fc48401aa9bd	kmiko28@gmail.com	allowlist_update	\N	2025-10-24 20:01:13.981305+00	2025-10-24 20:01:13.262+00	{"count": 1}
ccf3774c-c955-4ae0-995e-3a7f420a415a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 20:02:29.049834+00	2025-10-24 20:02:28.371+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
1f2af5d5-02c5-48e4-8726-80b9aa9c7b70	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 20:02:29.568464+00	2025-10-24 20:02:28.896+00	{"expires_at": "2025-10-24T20:07:28.538+00:00"}
459e5104-a64c-4652-be41-214d668b2aa8	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 20:03:12.890112+00	2025-10-24 20:03:12.181+00	\N
3a63abce-4418-4001-b620-6e10c7310d69	unknown	logout	\N	2025-10-24 20:18:15.433573+00	2025-10-24 20:18:14.598+00	\N
66b5182d-060f-4ca9-88c2-2d3c43986cef	kmiko28@gmail.com	login	\N	2025-10-24 20:18:34.734495+00	2025-10-24 20:18:33.994+00	\N
87e64237-b1f9-4753-93ad-1418a30aa93a	kmiko28@gmail.com	logout	\N	2025-10-24 20:25:36.029847+00	2025-10-24 20:25:34.979+00	\N
777ddd36-59b3-4dc7-82cd-b9624af5155b	kmiko28@gmail.com	login	\N	2025-10-24 20:37:21.874053+00	2025-10-24 20:37:20.992+00	\N
68275ee3-2ffc-4b95-995a-cc02ab7a7926	kmiko28@gmail.com	login	\N	2025-10-24 20:41:27.088+00	2025-10-24 20:41:26.235+00	\N
94929768-4be1-4a2d-b0d4-eaa821ede1c0	kmiko28@gmail.com	login	\N	2025-10-24 20:50:01.151793+00	2025-10-24 20:50:00.214+00	\N
d46965a0-faad-41ee-b162-9f93ca444e54	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:41:10.222413+00	2025-10-24 23:41:08.995+00	{"stage": "draft", "changed": {"hero_badge_size": {"after": "small", "before": "medium"}, "hero_subtext_size": {"after": "medium", "before": "large"}}, "changedKeys": ["hero_subtext_size", "hero_badge_size"]}
1dac2b1b-39d1-4aa7-86ad-ca68e2fae660	kmiko28@gmail.com	login	\N	2025-11-28 20:56:14.986421+00	2025-11-28 20:56:13.863+00	\N
c022e58b-911f-420e-b6df-b325a34de64d	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 20:50:03.673922+00	2025-10-24 20:50:02.905+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
e1c284c4-36dc-41f1-8b24-9027dc524455	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 20:50:03.999804+00	2025-10-24 20:50:03.224+00	{"expires_at": "2025-10-24T20:55:03.027+00:00"}
9eb21cb0-8ea7-4cbe-82e4-4214a68c5cf2	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 20:50:55.559418+00	2025-10-24 20:50:54.768+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-24T20:50:54.684Z"}
c923dffb-8dc5-4b6d-b272-9d7b775c0f9b	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 20:50:55.955031+00	2025-10-24 20:50:55.175+00	\N
b86c783c-5757-4026-baab-28e7adc3fcc8	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 20:51:10.897862+00	2025-10-24 20:51:10.108+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
a7867cdb-3b32-4fef-be3d-de5a9b921e06	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 20:51:11.205107+00	2025-10-24 20:51:10.411+00	{"expires_at": "2025-10-24T20:56:10.252+00:00"}
df3fdcb3-ddae-444d-b2ec-0330b85c4b6e	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 20:51:20.464647+00	2025-10-24 20:51:19.676+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-24T20:51:19.607Z"}
4a0da904-fe6c-4dfa-8299-7baf66996eb3	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 20:51:20.821848+00	2025-10-24 20:51:20.046+00	\N
5bef7f3c-4c78-49ed-86a6-fe074650614c	kmiko28@gmail.com	logout	\N	2025-10-24 20:58:01.041383+00	2025-10-24 20:57:59.888+00	\N
aef95497-c502-4671-a789-ae5e112e56f2	kmiko28@gmail.com	login	\N	2025-10-24 21:14:17.63008+00	2025-10-24 21:14:16.659+00	\N
48255e39-ec50-4696-a045-cd75aaa1706e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 21:14:30.434626+00	2025-10-24 21:14:29.553+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
89f40175-f5b3-40b7-a73e-c73c691e1c74	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:14:30.921014+00	2025-10-24 21:14:30.052+00	{"expires_at": "2025-10-24T21:19:29.727+00:00"}
955996cd-45d6-4cb2-930f-06deac49544a	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 21:14:35.373306+00	2025-10-24 21:14:34.54+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-24T21:14:34.467Z"}
546a8225-66e0-4870-b0d6-2c831a9f0ec8	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 21:14:35.702373+00	2025-10-24 21:14:34.861+00	\N
a9d30bf1-a848-4660-9705-677804d9af1c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 21:14:49.077845+00	2025-10-24 21:14:48.226+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
7f03bbcf-e872-423d-bdbf-71927bd61da0	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:14:49.37649+00	2025-10-24 21:14:48.533+00	{"expires_at": "2025-10-24T21:19:48.343+00:00"}
f442282b-f4d3-41c5-90bc-2ba6926ddd83	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 21:15:06.716402+00	2025-10-24 21:15:05.804+00	\N
cf4c62ed-c8e9-45fc-8218-fb4a3bd54150	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 21:15:12.264868+00	2025-10-24 21:15:11.395+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
54a63422-bdb7-4beb-b446-b4fc6b30b194	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:15:12.712611+00	2025-10-24 21:15:11.847+00	{"expires_at": "2025-10-24T21:20:11.564+00:00"}
cbc76193-0ea8-49b0-996d-88a49d1a09aa	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:16:13.280665+00	2025-10-24 21:16:12.42+00	{"expires_at": "2025-10-24T21:21:12.084+00:00"}
40ba4087-cafb-46dd-8a5b-18ea11be6fee	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:17:13.184635+00	2025-10-24 21:17:12.332+00	{"expires_at": "2025-10-24T21:22:12.06+00:00"}
1c0e6f18-a60e-4478-9adc-f9e3c2ecda81	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:18:13.1594+00	2025-10-24 21:18:12.311+00	{"expires_at": "2025-10-24T21:23:12.072+00:00"}
5387fd1e-36f9-474f-8445-75c73b7bda33	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 21:18:56.240098+00	2025-10-24 21:18:55.393+00	\N
6d3cc783-b975-4459-a5cd-e468c51e4357	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:41:29.890446+00	2025-10-24 23:41:28.667+00	{"expires_at": "2025-10-24T23:46:28.493+00:00"}
f158c494-ed70-4be4-abde-c3012737145e	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:41:32.862165+00	2025-10-24 23:41:31.641+00	{"stage": "draft", "changed": {}, "changedKeys": []}
d018a91c-593a-4f01-9c30-5d8f0092aaed	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 21:19:03.216344+00	2025-10-24 21:19:02.371+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
79e4ae85-1037-4efc-9866-2b9fef89db73	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:19:03.626604+00	2025-10-24 21:19:02.776+00	{"expires_at": "2025-10-24T21:24:02.481+00:00"}
f719788f-df71-4e9a-96a7-54ac66b4c545	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 21:19:44.515579+00	2025-10-24 21:19:43.634+00	\N
fdf85ab8-e308-4ddb-8a61-39141f5af946	kmiko28@gmail.com	login	\N	2025-10-24 21:35:23.863487+00	2025-10-24 21:35:22.839+00	\N
b6acbbfa-dcf5-41e4-bf38-c43df5a79c50	unknown	logout	\N	2025-10-24 21:41:32.836196+00	2025-10-24 21:41:31.527+00	\N
d962aa17-6a1e-44bf-8bbd-ece098204eb6	unknown	logout	\N	2025-10-24 21:50:45.94311+00	2025-10-24 21:50:44.894+00	\N
0ca33ce9-9aa0-46d3-b177-3c250e8a8379	kmiko28@gmail.com	login	\N	2025-10-24 21:55:52.898432+00	2025-10-24 21:55:51.856+00	\N
82177972-6197-46e9-ad88-f7baa8fe50c8	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 21:56:54.209563+00	2025-10-24 21:56:53.243+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global"]}
ee836d0b-7c5a-47e4-8249-ed8e0a0a6053	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:56:54.690257+00	2025-10-24 21:56:53.746+00	{"expires_at": "2025-10-24T22:01:53.389+00:00"}
1e6e12e3-2cf1-413e-bc1d-c753e1dfbe4d	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 21:57:05.920795+00	2025-10-24 21:57:04.959+00	{"stage": "draft", "changed": {}, "changedKeys": []}
153613cc-0a64-44d0-9d5c-d6d357a5dad6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:57:55.132312+00	2025-10-24 21:57:54.184+00	{"expires_at": "2025-10-24T22:02:53.908+00:00"}
ee4accf5-9d3c-4929-b58a-a6e7edb839b3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:58:55.064874+00	2025-10-24 21:58:54.108+00	{"expires_at": "2025-10-24T22:03:53.896+00:00"}
465d14e2-6dda-496c-a99f-e970d2fb1c88	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 21:59:55.188438+00	2025-10-24 21:59:54.18+00	{"expires_at": "2025-10-24T22:04:53.913+00:00"}
206103f9-6363-4c03-9078-3f519f37cc39	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 22:00:55.204263+00	2025-10-24 22:00:54.208+00	{"expires_at": "2025-10-24T22:05:53.93+00:00"}
171a5974-2d1b-4169-a812-f16e39892065	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 22:01:55.091348+00	2025-10-24 22:01:54.137+00	{"expires_at": "2025-10-24T22:06:53.936+00:00"}
a678430a-52c7-4e36-a42f-c9099ba646ca	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 22:02:55.074532+00	2025-10-24 22:02:54.114+00	{"expires_at": "2025-10-24T22:07:53.879+00:00"}
8a3df383-2e10-4b6e-8ea3-779544ede30e	kmiko28@gmail.com	logout	\N	2025-10-24 22:03:21.954218+00	2025-10-24 22:03:20.944+00	\N
c9a742fb-5f7c-4605-bde6-ed5aa4ed54d7	unknown	logout	\N	2025-10-24 22:14:46.304228+00	2025-10-24 22:14:44.957+00	\N
3f4b9731-38f7-44a0-927b-d9ce625e040f	kmiko28@gmail.com	login	\N	2025-10-24 23:35:15.750869+00	2025-10-24 23:35:14.258+00	\N
43d61e72-b4ce-4eec-8281-f26c034462dd	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:35:20.722943+00	2025-10-24 23:35:19.495+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
9ceb3c35-6186-4b39-bbb1-58abf3868455	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:35:21.287114+00	2025-10-24 23:35:20.073+00	{"expires_at": "2025-10-24T23:40:19.797+00:00"}
b9ec6a39-fd56-418e-aa84-0406fab519cf	kmiko28@gmail.com	media.upload	\N	2025-10-24 23:36:20.441854+00	2025-10-24 23:36:19.179+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png", "path": "1761348978901_TooFunny.png", "size": 44908, "mimetype": "image/png", "originalName": "TooFunny.png"}
10593e26-5b11-4dc7-b1e2-312fb81727e6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:36:21.714997+00	2025-10-24 23:36:20.374+00	{"expires_at": "2025-10-24T23:41:20.187+00:00"}
db33246d-86ad-4abe-b781-7277f5430e03	kmiko28@gmail.com	media.upload	\N	2025-10-24 23:36:21.949774+00	2025-10-24 23:36:20.698+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "path": "1761348980373_TooFunny.png", "size": 44908, "mimetype": "image/png", "originalName": "TooFunny.png"}
319b657e-90ef-4404-8f6b-a19c940256f2	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:36:32.162796+00	2025-10-24 23:36:30.954+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png"}}, "changedKeys": ["logo_url", "favicon_url"]}
2f9e41a0-8971-4b3e-967a-ffd5a58aa76c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 23:36:34.215425+00	2025-10-24 23:36:33.004+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png"}}, "changedKeys": ["logo_url", "favicon_url"], "published_at": "2025-10-24T23:36:32.937Z"}
80fc9549-6f9c-4dc6-889f-f40608f6651f	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 23:36:34.612349+00	2025-10-24 23:36:33.403+00	\N
7aed23ab-94a2-4369-9891-329b024dea93	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:47:46.47468+00	2025-10-25 00:47:45.089+00	{"expires_at": "2025-10-25T00:52:44.851+00:00"}
06481475-ac2d-47a1-93f3-43c95f846f05	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:38:46.685059+00	2025-10-25 01:38:45.133+00	{"expires_at": "2025-10-25T01:43:44.854+00:00"}
a951991d-7b4c-413d-ada9-5a03cf8f70de	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:36:58.926306+00	2025-10-24 23:36:57.7+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
fe2cd051-7058-434c-a022-205241187d00	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:36:59.266099+00	2025-10-24 23:36:58.047+00	{"expires_at": "2025-10-24T23:41:57.831+00:00"}
64136174-8d5b-4392-af5f-855dc01db86a	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:37:08.033706+00	2025-10-24 23:37:06.818+00	{"stage": "draft", "changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png"}}, "changedKeys": ["hero_image_url"]}
f42a2c4e-3510-4c7a-bfd9-696f1a56d712	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 23:37:09.932125+00	2025-10-24 23:37:08.719+00	{"changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png"}}, "changedKeys": ["hero_image_url"], "published_at": "2025-10-24T23:37:08.640Z"}
b0ccbbe1-1122-4aed-b0f1-72d829ac58c5	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 23:37:10.333027+00	2025-10-24 23:37:09.116+00	\N
23c80d48-68e6-4990-8323-943713a373fa	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:39:55.170632+00	2025-10-24 23:39:53.958+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
d8dc10bd-422e-4621-a531-989269570383	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:39:55.476596+00	2025-10-24 23:39:54.264+00	{"expires_at": "2025-10-24T23:44:54.05+00:00"}
b17fe3e2-36e7-4e18-8500-28ad029b54e2	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:40:04.689085+00	2025-10-24 23:40:03.477+00	{"stage": "draft", "changed": {"hero_title_size": {"after": "large", "before": "medium"}}, "changedKeys": ["hero_title_size"]}
1794dad4-43b7-4109-a6a3-ac836c560e2c	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 23:40:08.401604+00	2025-10-24 23:40:07.191+00	{"changed": {"hero_title_size": {"after": "large", "before": "medium"}}, "changedKeys": ["hero_title_size"], "published_at": "2025-10-24T23:40:07.132Z"}
697b947a-23ce-4e29-a225-2de5b19f9618	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 23:40:08.727676+00	2025-10-24 23:40:07.516+00	\N
4c97f0fe-9d9c-4c49-bb35-554277f0b5a4	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:40:29.302722+00	2025-10-24 23:40:28.091+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
1625869b-ead5-4e48-bbf4-0c3a5c30e065	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:40:29.596615+00	2025-10-24 23:40:28.379+00	{"expires_at": "2025-10-24T23:45:28.179+00:00"}
f7a6c4f2-364f-4e81-aed5-c5a483685a95	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:40:32.648772+00	2025-10-24 23:40:31.433+00	{"stage": "draft", "changed": {"hero_title_size": {"after": "small", "before": "large"}}, "changedKeys": ["hero_title_size"]}
b7f0a9d0-ce7b-41e1-8435-4001aa28edee	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:40:42.090577+00	2025-10-24 23:40:40.863+00	{"stage": "draft", "changed": {"hero_title_size": {"after": "medium", "before": "small"}}, "changedKeys": ["hero_title_size"]}
7c95d7fb-c91e-42f0-8e14-b137e8ba14fa	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:40:50.486186+00	2025-10-24 23:40:49.255+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg"}, "theme_bg": {"after": "linear-gradient(to right, #000, #1a1a40)", "before": "#FD641A"}, "who_body": {"after": null, "before": "Too Funny Productions is a collective of comedians, directors, editors, and techs bringing high-energy sketch and improv."}, "footer_bg": {"after": "#000000", "before": "#DF0101"}, "header_bg": {"after": "#000000", "before": "#DF0101"}, "who_title": {"after": null, "before": "Who We Are"}, "about_team": {"after": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "This is the bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "hero_title": {"after": "Comedy That's TOO FUNNY", "before": "Comedy That's Too Funny"}, "events_past": {"after": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "before": []}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png"}, "contactemail": {"after": "info@toofunnyproductions.com", "before": null}, "theme_accent": {"after": "#FFD700", "before": "#FD87C6"}, "who_image_url": {"after": null, "before": ""}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}, "media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": ""}], "title": "New Section"}]}, "contact_socials": {"after": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "before": []}, "events_upcoming": {"after": [], "before": [{"date": "1/1/2025", "link": "www.google.com", "title": "First", "venue": "Downtown"}]}, "admin_quick_links": {"after": [], "before": [{"url": "https://drive.google.com/drive/u/0/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Drive Backup"}]}, "hero_subtext_size": {"after": "large", "before": "medium"}}, "changedKeys": ["logo_url", "favicon_url", "hero_title", "hero_image_url", "contactemail", "contact_socials", "theme_accent", "theme_bg", "header_bg", "footer_bg", "who_title", "who_body", "about_team", "events_upcoming", "events_past", "media_sections", "admin_quick_links", "who_image_url", "hero_subtext_size"]}
9b02b876-c467-4d41-8486-a7ab9eacf927	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:48:46.491957+00	2025-10-25 00:48:45.102+00	{"expires_at": "2025-10-25T00:53:44.883+00:00"}
8f1f737a-2002-4af4-a7c0-2a8f7787dd21	kmiko28@gmail.com	login	\N	2025-11-28 21:01:04.81836+00	2025-11-28 21:01:03.978+00	\N
f5553ba3-5413-479d-b70b-9a9496f94f1d	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:41:33.959288+00	2025-10-24 23:41:32.727+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
5bdb3835-11df-4a08-ac7a-ebe6bf1b94e6	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:41:39.951095+00	2025-10-24 23:41:38.721+00	{"stage": "draft", "changed": {}, "changedKeys": []}
5bf90367-594d-4b2d-aa2f-3051d544da5c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:42:29.913513+00	2025-10-24 23:42:28.691+00	{"expires_at": "2025-10-24T23:47:28.527+00:00"}
5e25adf4-5019-47f3-8543-1808a160dc60	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:43:30.250162+00	2025-10-24 23:43:29.016+00	{"expires_at": "2025-10-24T23:48:28.832+00:00"}
f35eeffb-6d45-42da-abf3-369d436687e6	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 23:43:38.713415+00	2025-10-24 23:43:37.427+00	\N
b52a1f9e-e38f-4b95-afd1-068315c22090	kmiko28@gmail.com	media.delete	\N	2025-10-24 23:44:01.107278+00	2025-10-24 23:43:59.832+00	{"path": "1760485413806_P.jpg", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760485413806_P.jpg"}
8ed46163-55d7-419b-be0a-f45ecba022e4	kmiko28@gmail.com	media.delete	\N	2025-10-24 23:44:10.360354+00	2025-10-24 23:44:09.084+00	{"path": "1761348980373_TooFunny.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}
092132b0-449b-488e-bc47-678af7941397	kmiko28@gmail.com	login	\N	2025-10-24 23:58:59.85342+00	2025-10-24 23:58:58.508+00	\N
ca893ef4-94bc-4889-af03-da22a6eb23c3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:59:02.932668+00	2025-10-24 23:59:01.642+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
9bb741bd-c772-4e4e-bffa-d35202530ed3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-24 23:59:03.286273+00	2025-10-24 23:59:01.995+00	{"expires_at": "2025-10-25T00:04:01.789+00:00"}
974ae5b9-b8d7-4d37-a635-bd3b55575d36	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-24 23:59:27.360508+00	2025-10-24 23:59:26.064+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
7c049161-218b-4783-bc57-31245845ff25	kmiko28@gmail.com	media.upload	\N	2025-10-24 23:59:37.096688+00	2025-10-24 23:59:35.821+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "path": "1761350375464_TooFunny.png", "size": 44908, "mimetype": "image/png", "originalName": "TooFunny.png"}
cde4929b-7a6d-4888-9742-33d66c49e3ef	kmiko28@gmail.com	settings.update.draft	\N	2025-10-24 23:59:38.857903+00	2025-10-24 23:59:37.593+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}}, "changedKeys": ["logo_url"]}
df4a3bb1-4f86-4340-8dc3-3f2325432608	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-24 23:59:39.867088+00	2025-10-24 23:59:38.603+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-24T23:59:38.530Z"}
9117ef4f-2d9a-432d-9bdd-47f322cfdef2	kmiko28@gmail.com	settings.lock.release	\N	2025-10-24 23:59:40.18159+00	2025-10-24 23:59:38.912+00	\N
65160b63-e2c3-4dde-88fe-7338bbb5c7d8	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 00:07:37.35518+00	2025-10-25 00:07:36.047+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
53f3df2d-6fe3-45c5-812b-558f31e033ca	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:07:37.756736+00	2025-10-25 00:07:36.475+00	{"expires_at": "2025-10-25T00:12:36.186+00:00"}
e70bd596-9af9-4f5f-8b0a-e6605302753d	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 00:08:36.26955+00	2025-10-25 00:08:34.949+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/19Ur8byBlpAm7ulpHEzxhDrDFFBk3wsFr", "label": "Google Backup Folder"}, {"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Google Admin Docs"}], "before": []}}, "changedKeys": ["admin_quick_links"]}
8bce05e6-dbe8-45f2-98c9-15fb21e8dde3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:08:38.007075+00	2025-10-25 00:08:36.721+00	{"expires_at": "2025-10-25T00:13:36.599+00:00"}
1096d0c3-a6c9-4171-bb28-e8b828b477ce	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 00:08:39.145037+00	2025-10-25 00:08:37.857+00	\N
ee6b4f63-e057-4ede-88fb-610fe3b95116	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:50:53.739572+00	2025-10-25 00:50:52.346+00	{"expires_at": "2025-10-25T00:55:52.172+00:00"}
c67019b6-4314-4c97-b33b-3f403e7db81f	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 00:08:38.775256+00	2025-10-25 00:08:37.487+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T00:08:37.418Z"}
19880b52-70e1-40cc-af64-4f8971a721cc	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 00:09:18.869592+00	2025-10-25 00:09:17.552+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
0de82aab-8aff-46aa-9e87-fc0a20899bc2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:09:19.115082+00	2025-10-25 00:09:17.828+00	{"expires_at": "2025-10-25T00:14:17.671+00:00"}
7bfe5653-be5d-4d4f-a412-72032bf2c825	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:10:19.473088+00	2025-10-25 00:10:18.168+00	{"expires_at": "2025-10-25T00:15:17.948+00:00"}
8d3c2150-3821-401a-aacf-48f0a2a228d5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:11:19.463393+00	2025-10-25 00:11:18.163+00	{"expires_at": "2025-10-25T00:16:17.95+00:00"}
43d7a3d8-5d1b-4662-9abb-64c1ab20f620	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:12:20.612325+00	2025-10-25 00:12:19.311+00	{"expires_at": "2025-10-25T00:17:18.844+00:00"}
b5f78781-4d02-4189-b2ed-e336f1cc76d3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:13:20.396012+00	2025-10-25 00:13:19.086+00	{"expires_at": "2025-10-25T00:18:18.84+00:00"}
2dbb9b94-a595-4626-ad67-64d580fb2770	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:14:20.457211+00	2025-10-25 00:14:19.154+00	{"expires_at": "2025-10-25T00:19:18.886+00:00"}
0b18ab44-946a-4676-999f-361ab095d018	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:15:20.374418+00	2025-10-25 00:15:19.071+00	{"expires_at": "2025-10-25T00:20:18.865+00:00"}
f091122c-67a2-4fc0-b143-11364511367c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:16:46.410237+00	2025-10-25 00:16:45.101+00	{"expires_at": "2025-10-25T00:21:44.846+00:00"}
a1b43265-4218-4d08-8f51-cd6c601488fa	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:17:47.475793+00	2025-10-25 00:17:46.167+00	{"expires_at": "2025-10-25T00:22:45.891+00:00"}
5bbae2c8-2c2e-4d36-9cb1-3107ade90aec	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:18:46.421965+00	2025-10-25 00:18:45.089+00	{"expires_at": "2025-10-25T00:23:44.841+00:00"}
8bf2d10c-0446-4261-8f8b-85ac788ebd71	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:19:46.405887+00	2025-10-25 00:19:45.097+00	{"expires_at": "2025-10-25T00:24:44.888+00:00"}
d9082d37-b14e-44ed-a91d-45de7d4e0eeb	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:20:46.474683+00	2025-10-25 00:20:45.14+00	{"expires_at": "2025-10-25T00:25:44.857+00:00"}
3231cc6a-dcb0-4e19-b7e8-155e1757debe	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:21:46.604874+00	2025-10-25 00:21:45.28+00	{"expires_at": "2025-10-25T00:26:44.842+00:00"}
00846819-772b-470b-8dcb-969b0f2954f1	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:22:46.480566+00	2025-10-25 00:22:45.122+00	{"expires_at": "2025-10-25T00:27:44.843+00:00"}
ee928975-cc8c-4d00-a402-49716bfa1d2e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:23:40.91667+00	2025-10-25 00:23:39.577+00	{"expires_at": "2025-10-25T00:28:39.343+00:00"}
756cc2a4-b7f4-40af-a72c-cf96b0d39647	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 00:23:44.214695+00	2025-10-25 00:23:42.878+00	\N
e4bbb6b4-fa47-4bca-b58e-8bb797f0aa40	unknown	logout	\N	2025-10-25 00:25:38.013567+00	2025-10-25 00:25:36.595+00	\N
2b5b2e6b-bbe0-412e-a87f-885b7f31de5c	kmiko28@gmail.com	login	\N	2025-10-25 00:26:10.55122+00	2025-10-25 00:26:09.147+00	\N
3d28766a-5368-4199-9d63-0a7cccd3d077	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 00:26:25.903696+00	2025-10-25 00:26:24.57+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
b021c200-8677-4fd6-9bcc-cc33123964dd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:26:26.196092+00	2025-10-25 00:26:24.865+00	{"expires_at": "2025-10-25T00:31:24.694+00:00"}
80198b70-8ff3-4a28-ae94-6145d6a38bfe	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:27:26.526911+00	2025-10-25 00:27:25.194+00	{"expires_at": "2025-10-25T00:32:24.97+00:00"}
a50890b0-5cfe-46a0-a570-8c2150aa3d39	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:28:26.561376+00	2025-10-25 00:28:25.207+00	{"expires_at": "2025-10-25T00:33:24.981+00:00"}
300bcec0-b227-43b3-8648-5aeab7f08c07	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:29:26.591972+00	2025-10-25 00:29:25.246+00	{"expires_at": "2025-10-25T00:34:24.983+00:00"}
66ffb8f8-211a-442d-b0e9-cba35b5e1044	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:30:26.752358+00	2025-10-25 00:30:25.394+00	{"expires_at": "2025-10-25T00:35:25.01+00:00"}
e8c5ffbe-82db-4af2-a908-96cfe9994dcf	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:31:26.677759+00	2025-10-25 00:31:25.333+00	{"expires_at": "2025-10-25T00:36:25.034+00:00"}
465ee97f-8075-4fbc-86de-c84b53f23cc1	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:32:26.525933+00	2025-10-25 00:32:25.182+00	{"expires_at": "2025-10-25T00:37:24.978+00:00"}
3268c8ca-2b9e-47ea-99ad-acfcbb9bead0	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:33:27.524997+00	2025-10-25 00:33:26.174+00	{"expires_at": "2025-10-25T00:38:25.886+00:00"}
da350c89-fe1e-4e50-999d-608efbe0b578	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:34:46.461161+00	2025-10-25 00:34:45.11+00	{"expires_at": "2025-10-25T00:39:44.881+00:00"}
03e03806-6901-42b2-bb77-81bd4b90c593	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:35:46.545061+00	2025-10-25 00:35:45.177+00	{"expires_at": "2025-10-25T00:40:44.887+00:00"}
0a7e2158-bfcb-4f22-90ae-6f272db82424	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:36:46.500533+00	2025-10-25 00:36:45.128+00	{"expires_at": "2025-10-25T00:41:44.898+00:00"}
70c9898f-d915-4936-9ce9-7d7016d18136	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:37:46.445682+00	2025-10-25 00:37:45.081+00	{"expires_at": "2025-10-25T00:42:44.87+00:00"}
c5ee7c96-8b84-44ee-a26a-a38a6bd9df50	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:38:46.46372+00	2025-10-25 00:38:45.092+00	{"expires_at": "2025-10-25T00:43:44.885+00:00"}
e57da63c-10b4-4e2b-bf78-12c79c5809e8	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:39:46.518454+00	2025-10-25 00:39:45.138+00	{"expires_at": "2025-10-25T00:44:44.859+00:00"}
b8ee861d-646e-455b-ab05-8b4206c83c73	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:40:46.476447+00	2025-10-25 00:40:45.085+00	{"expires_at": "2025-10-25T00:45:44.849+00:00"}
4d6c1dda-8af2-4a1c-ab46-1bd36c15dd04	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:41:46.565812+00	2025-10-25 00:41:45.183+00	{"expires_at": "2025-10-25T00:46:44.856+00:00"}
c1c8aef7-447d-46df-8081-922afebf7fea	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:42:46.626957+00	2025-10-25 00:42:45.214+00	{"expires_at": "2025-10-25T00:47:44.918+00:00"}
eb49175f-da13-4e30-ae65-1e22fd91c41d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 00:43:46.507716+00	2025-10-25 00:43:45.121+00	{"expires_at": "2025-10-25T00:48:44.836+00:00"}
f95c9461-bc37-4eaf-93b2-599a278f5e22	kmiko28@gmail.com	login	\N	2025-10-25 00:50:47.005297+00	2025-10-25 00:50:45.6+00	\N
7ed14409-5080-4185-ac84-5fa2710912a3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 00:50:53.461312+00	2025-10-25 00:50:52.058+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
79d3d296-be1f-46a8-932a-4eb1438ea62d	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 00:51:12.154016+00	2025-10-25 00:51:10.761+00	\N
8ce615be-564e-4c9b-a98c-e89099d0f92e	kmiko28@gmail.com	media.delete	\N	2025-10-25 00:51:54.522318+00	2025-10-25 00:51:53.085+00	{"path": "1759712704518.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1759712704518.png"}
0e1b67f1-c441-483c-86ca-a3760033b265	unknown	logout	\N	2025-10-25 00:52:12.921888+00	2025-10-25 00:52:11.407+00	\N
c776b511-1980-48d1-b019-9716e948b632	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 00:51:10.156292+00	2025-10-25 00:51:08.764+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}}, "changedKeys": ["logo_url", "favicon_url"]}
41fe2b87-6d02-4e38-803e-08ab55f5318a	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 00:51:11.830276+00	2025-10-25 00:51:10.443+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}}, "changedKeys": ["logo_url", "favicon_url"], "published_at": "2025-10-25T00:51:10.388Z"}
9fb37619-251a-478e-a73a-8b711cf8fb30	kmiko28@gmail.com	media.delete	\N	2025-10-25 00:51:49.890482+00	2025-10-25 00:51:48.441+00	{"path": "1761348978901_TooFunny.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}
bcbf0bee-fbb4-4fd8-bd57-e3674ca03b81	kmiko28@gmail.com	media.delete	\N	2025-10-25 00:51:57.505247+00	2025-10-25 00:51:56.065+00	{"path": "1761071404134_TooFunnyThePrequel.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071404134_TooFunnyThePrequel.png"}
f9c46a2e-194c-4c1c-9869-4fa2641ba60b	kmiko28@gmail.com	login	\N	2025-10-25 01:22:10.987799+00	2025-10-25 01:22:09.402+00	\N
2436b184-5370-4c79-8eab-eab6414f7b9c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 01:22:15.888332+00	2025-10-25 01:22:14.396+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
ec3d70d7-6188-4100-824b-ea614b4f330f	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:22:16.298956+00	2025-10-25 01:22:14.79+00	{"expires_at": "2025-10-25T01:27:14.537+00:00"}
908a8069-c9a7-417b-b37f-7d1a3c692eb5	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 01:22:35.460077+00	2025-10-25 01:22:33.963+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
e4ea4460-91cd-497d-acda-be227b79d385	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 01:22:43.577069+00	2025-10-25 01:22:42.103+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-25T01:22:42.024Z"}
b0a47141-9687-4d0a-aa3a-1dbb983b109a	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 01:22:44.002366+00	2025-10-25 01:22:42.514+00	\N
70dcaa22-0702-44f1-ac13-b7bf1bd73323	kmiko28@gmail.com	login	\N	2025-10-25 01:24:58.923513+00	2025-10-25 01:24:57.378+00	\N
de3bb44c-45eb-468e-9f0b-09f4a22c3c44	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 01:25:19.28324+00	2025-10-25 01:25:17.784+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
f74fef76-7b14-4e3a-965f-0a5b2a3c6687	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:25:19.572985+00	2025-10-25 01:25:18.065+00	{"expires_at": "2025-10-25T01:30:17.925+00:00"}
07a71462-dbc4-4485-a6c8-d10cfa8aaee5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:26:19.863643+00	2025-10-25 01:26:18.365+00	{"expires_at": "2025-10-25T01:31:18.189+00:00"}
21f4c5c1-705b-4ae1-ae9c-4d0ae4edeac8	kmiko28@gmail.com	contact_response_update	\N	2025-10-25 01:26:36.887684+00	2025-10-25 01:26:35.393+00	{"id": "5f709fd1-f137-4386-8ca9-70638ba9a810", "hasNotes": true, "responded": false}
f0baaedd-b221-43b2-aa08-84dcdf5de19f	kmiko28@gmail.com	contact_response_update	\N	2025-10-25 01:26:39.280481+00	2025-10-25 01:26:37.768+00	{"id": "5f709fd1-f137-4386-8ca9-70638ba9a810", "hasNotes": true, "responded": true}
e01e87ea-81c3-4994-8571-e629b6237a1b	kmiko28@gmail.com	contact_response_update	\N	2025-10-25 01:26:40.597335+00	2025-10-25 01:26:39.101+00	{"id": "f17bbcec-e07d-4a23-a096-ced226c1d60a", "hasNotes": false, "responded": true}
83c4a871-60c9-4a3f-9183-79cd7befaebe	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:27:19.892825+00	2025-10-25 01:27:18.409+00	{"expires_at": "2025-10-25T01:32:18.197+00:00"}
6f4acab8-253c-4e03-9e80-856990e23234	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:28:20.612647+00	2025-10-25 01:28:19.118+00	{"expires_at": "2025-10-25T01:33:18.869+00:00"}
9c34ff7a-19d2-4cea-a89f-94c3971cc699	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:29:20.602188+00	2025-10-25 01:29:19.074+00	{"expires_at": "2025-10-25T01:34:18.878+00:00"}
a6cc0103-cfa0-4b9d-9d69-c8c090265b17	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:30:20.604271+00	2025-10-25 01:30:19.109+00	{"expires_at": "2025-10-25T01:35:18.888+00:00"}
2087edd9-0492-44f2-8ec9-0152f09b14b5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:31:22.266979+00	2025-10-25 01:31:20.765+00	{"expires_at": "2025-10-25T01:36:20.542+00:00"}
ac3932ef-4b3d-4f0f-8d9b-1f9bc081b93a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:32:46.61452+00	2025-10-25 01:32:45.109+00	{"expires_at": "2025-10-25T01:37:44.899+00:00"}
cac10b07-fe58-4e78-a448-6365fec0437b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:33:46.596209+00	2025-10-25 01:33:45.079+00	{"expires_at": "2025-10-25T01:38:44.882+00:00"}
1b40097b-dea1-4fb2-858c-79eb355e255a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:34:46.994074+00	2025-10-25 01:34:45.46+00	{"expires_at": "2025-10-25T01:39:44.849+00:00"}
ed6abedb-500c-4de9-9205-cea15bedc000	kmiko28@gmail.com	logout	\N	2025-11-28 21:01:22.224658+00	2025-11-28 21:01:21.446+00	\N
37976817-cd25-41c5-bc87-1d79ee05c9c4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:40:46.733676+00	2025-10-25 01:40:45.155+00	{"expires_at": "2025-10-25T01:45:44.836+00:00"}
088e4817-da86-4e37-b442-d9b3c87aaa44	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:41:46.634377+00	2025-10-25 01:41:45.104+00	{"expires_at": "2025-10-25T01:46:44.89+00:00"}
9817a6c7-1392-470c-9ed2-fbaa749b50f1	unknown	logout	\N	2025-10-25 01:59:18.432843+00	2025-10-25 01:59:16.384+00	\N
5aaecd54-c24c-4404-ad72-9c396735897b	kmiko28@gmail.com	login	\N	2025-10-25 01:59:28.400807+00	2025-10-25 01:59:26.753+00	\N
723aefe0-cd72-442e-b02a-104cf7287ef9	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 01:59:31.417463+00	2025-10-25 01:59:29.834+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
25503734-012a-45e0-9077-6592c3f76bcd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:59:31.731206+00	2025-10-25 01:59:30.157+00	{"expires_at": "2025-10-25T02:04:29.958+00:00"}
e35534bf-6c10-40a2-b0b2-95baaac95890	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 01:59:50.340842+00	2025-10-25 01:59:48.762+00	{"stage": "draft", "changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"]}
e08941b1-1849-40ca-89e9-fc95e6121ab5	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 01:59:51.84388+00	2025-10-25 01:59:50.268+00	{"changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T01:59:50.199Z"}
3742bbba-e4b4-449c-a5b8-54f7993a4182	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 01:59:52.16668+00	2025-10-25 01:59:50.581+00	\N
5a4da0ff-d5f3-47c1-94af-5982eef09c29	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 01:59:55.364448+00	2025-10-25 01:59:53.792+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
8095d0d6-c555-40f4-a39c-740025b7873c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 01:59:55.671304+00	2025-10-25 01:59:54.097+00	{"expires_at": "2025-10-25T02:04:53.887+00:00"}
18b8eaeb-ec29-4e48-a0a8-e2383e08d8b3	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 02:00:01.07447+00	2025-10-25 01:59:59.486+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": ""}}, "changedKeys": ["logo_url"]}
10ba8b98-9501-49de-9260-0d6d0007b28d	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 02:00:02.190884+00	2025-10-25 02:00:00.608+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": ""}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T02:00:00.540Z"}
e6698ee8-f9cb-46d3-ae04-575cf4374f78	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 02:00:02.514594+00	2025-10-25 02:00:00.937+00	\N
68fc4587-0e03-4ea3-96da-2a438b6239e1	kmiko28@gmail.com	login	\N	2025-10-25 02:18:11.518596+00	2025-10-25 02:18:09.801+00	\N
9b8da7f2-38d2-44f9-bbd9-1fb4ff85375e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 02:18:58.454128+00	2025-10-25 02:18:56.816+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
a19a6a8a-b55e-4dd1-80a4-5b747ed66020	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 02:18:58.782434+00	2025-10-25 02:18:57.143+00	{"expires_at": "2025-10-25T02:23:56.962+00:00"}
2ddcbc50-df53-4742-94a4-c23d77ea229c	kmiko28@gmail.com	media.upload	\N	2025-10-25 02:19:06.861978+00	2025-10-25 02:19:05.173+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png", "path": "1761358744788_TooFunny.png", "size": 44908, "mimetype": "image/png", "originalName": "TooFunny.png"}
0e29e68d-f64d-42a1-b681-e448af27bc0c	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 02:19:09.563588+00	2025-10-25 02:19:07.917+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"]}
7b9bfd3c-24f2-45e6-b7ce-f5596540ceeb	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 02:19:10.95828+00	2025-10-25 02:19:09.326+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T02:19:09.252Z"}
ae655f34-3b64-4b74-aa89-b91ed964c697	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 02:19:11.42276+00	2025-10-25 02:19:09.751+00	\N
8d04b46d-64bd-44de-9570-8b590fdb0884	kmiko28@gmail.com	login	\N	2025-10-25 03:30:30.749105+00	2025-10-25 03:30:28.826+00	\N
9a63fe66-60c6-40cd-8e5c-3ac068422c09	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:39:47.316508+00	2025-10-25 05:39:45.116+00	{"expires_at": "2025-10-25T05:44:44.868+00:00"}
3f34dd1f-2bb5-4a88-ae50-f7d02f5b9e34	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:40:47.307113+00	2025-10-25 05:40:45.14+00	{"expires_at": "2025-10-25T05:45:44.885+00:00"}
02c05b90-bbf8-465b-83c7-f776b255d75d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:41:47.237667+00	2025-10-25 05:41:45.064+00	{"expires_at": "2025-10-25T05:46:44.878+00:00"}
96f6a421-15d6-47da-ad39-4013623c3dda	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:42:47.27856+00	2025-10-25 05:42:45.103+00	{"expires_at": "2025-10-25T05:47:44.881+00:00"}
b1cb02b0-be2e-4f8b-9199-1748ff6d0e07	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:43:47.49063+00	2025-10-25 05:43:45.32+00	{"expires_at": "2025-10-25T05:48:45.011+00:00"}
fe9c1b42-4ba9-4d02-9236-b6201dcc376e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 03:30:34.746638+00	2025-10-25 03:30:32.882+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
d7b8e2c3-3b3c-41bf-8650-2cd3a0caf3cb	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 03:30:35.182411+00	2025-10-25 03:30:33.345+00	{"expires_at": "2025-10-25T03:35:33.054+00:00"}
78f68777-76c5-4b9b-b0e1-34121fc937f1	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 03:30:37.44986+00	2025-10-25 03:30:35.612+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-25T03:30:35.537Z"}
250e726c-3278-4b52-8ee2-b13769be5e88	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 03:30:37.827448+00	2025-10-25 03:30:35.993+00	\N
c46c3de9-b64d-4755-add7-db8e5c914765	kmiko28@gmail.com	login	\N	2025-10-25 04:37:54.082297+00	2025-10-25 04:37:51.985+00	\N
e9be44db-9c66-4fc0-a1b4-faa87df08695	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 04:37:57.437113+00	2025-10-25 04:37:55.414+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
345dfee2-b56d-4cc4-93e3-4b8d4daf3133	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 04:37:57.799283+00	2025-10-25 04:37:55.81+00	{"expires_at": "2025-10-25T04:42:55.575+00:00"}
43272174-546d-4867-8d36-3b443d3bb60a	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 04:38:06.046479+00	2025-10-25 04:38:04.047+00	{"stage": "draft", "changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png"}}, "changedKeys": ["logo_url"]}
a6c6539c-6e5a-4c82-8273-7c4cf3997527	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 04:38:23.224473+00	2025-10-25 04:38:21.246+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": ""}}, "changedKeys": ["logo_url"]}
de5820e8-9d07-45ed-ae71-03ba96d5cfdd	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 04:38:30.58069+00	2025-10-25 04:38:28.596+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T04:38:28.546Z"}
a0458786-cade-4ab5-977a-42e13ffbba23	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 04:38:30.840318+00	2025-10-25 04:38:28.858+00	\N
9d10c615-9f84-4aae-980a-ff05176023b7	kmiko28@gmail.com	login	\N	2025-10-25 05:21:32.855193+00	2025-10-25 05:21:30.674+00	\N
8339af42-875b-42b0-b28b-07416d4cde68	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 05:21:35.549901+00	2025-10-25 05:21:33.412+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
1ccedcda-742f-4dd7-bacc-655f4ee830e9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:21:35.839614+00	2025-10-25 05:21:33.717+00	{"expires_at": "2025-10-25T05:26:33.542+00:00"}
7f831345-583b-47b4-88ec-b4224c9cd349	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:22:37.218309+00	2025-10-25 05:22:35.102+00	{"expires_at": "2025-10-25T05:27:34.877+00:00"}
177fa19d-e9f7-4d98-af28-0cb2876c040a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:23:37.158559+00	2025-10-25 05:23:35.037+00	{"expires_at": "2025-10-25T05:28:34.861+00:00"}
29e477b9-6f44-4e66-8116-8c5d5fc03a51	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:24:37.210604+00	2025-10-25 05:24:35.085+00	{"expires_at": "2025-10-25T05:29:34.852+00:00"}
3afa301c-aa04-4d27-9dbf-d9c4b6513026	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:25:37.206589+00	2025-10-25 05:25:35.078+00	{"expires_at": "2025-10-25T05:30:34.867+00:00"}
ac39bd94-2efd-4205-a18e-886964e806c8	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:26:37.380123+00	2025-10-25 05:26:35.221+00	{"expires_at": "2025-10-25T05:31:34.963+00:00"}
d6469d29-b1b6-4a91-b550-516e7f1aca2e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:27:37.208988+00	2025-10-25 05:27:35.051+00	{"expires_at": "2025-10-25T05:32:34.831+00:00"}
8e3b4e93-b891-42d5-81be-7ddd15443322	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:28:47.223809+00	2025-10-25 05:28:45.09+00	{"expires_at": "2025-10-25T05:33:44.833+00:00"}
96222792-1041-4480-b879-98254c048b34	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:29:47.228438+00	2025-10-25 05:29:45.083+00	{"expires_at": "2025-10-25T05:34:44.828+00:00"}
fdd7a2b4-1d2a-4cb3-b869-cbfe6b93de17	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:30:47.296135+00	2025-10-25 05:30:45.157+00	{"expires_at": "2025-10-25T05:35:44.876+00:00"}
d2e17366-c9ff-4681-af1f-35e97f38317c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:31:47.711692+00	2025-10-25 05:31:45.533+00	{"expires_at": "2025-10-25T05:36:44.917+00:00"}
0a0293ff-c930-4bb7-b0e4-5df2ab11caac	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:32:47.361576+00	2025-10-25 05:32:45.181+00	{"expires_at": "2025-10-25T05:37:44.879+00:00"}
ccab9299-6d38-460f-a753-a89b925405e5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:33:47.490803+00	2025-10-25 05:33:45.28+00	{"expires_at": "2025-10-25T05:38:44.866+00:00"}
f4423fa2-2030-4184-89bd-42284ca61e35	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:34:47.326853+00	2025-10-25 05:34:45.152+00	{"expires_at": "2025-10-25T05:39:44.865+00:00"}
dec9a809-82ea-4aaa-b113-4cec0a554ec7	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:35:47.654206+00	2025-10-25 05:35:45.469+00	{"expires_at": "2025-10-25T05:40:44.872+00:00"}
552e6b97-328a-4f1a-916d-2c4314436229	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:36:47.518508+00	2025-10-25 05:36:45.333+00	{"expires_at": "2025-10-25T05:41:44.869+00:00"}
2fdc9b15-6c9e-4f73-95b0-08a37e91b29d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:37:47.434358+00	2025-10-25 05:37:45.219+00	{"expires_at": "2025-10-25T05:42:44.959+00:00"}
cd0205fa-b6f8-44fb-a55d-ea4c5c76fd1c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:38:47.258525+00	2025-10-25 05:38:45.085+00	{"expires_at": "2025-10-25T05:43:44.879+00:00"}
72ebfca5-d14f-48df-a972-48d38ed2a9cd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:44:47.502458+00	2025-10-25 05:44:45.308+00	{"expires_at": "2025-10-25T05:49:44.93+00:00"}
98ce9833-96f6-4e32-bc13-57f415bcc927	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:45:47.358564+00	2025-10-25 05:45:45.18+00	{"expires_at": "2025-10-25T05:50:44.875+00:00"}
da0db012-b99f-440b-82dd-3f8f76cd32d2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:46:47.324525+00	2025-10-25 05:46:45.146+00	{"expires_at": "2025-10-25T05:51:44.822+00:00"}
89c5efb2-ed70-4e8a-85c3-df562c01e8a5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:47:47.266553+00	2025-10-25 05:47:45.08+00	{"expires_at": "2025-10-25T05:52:44.839+00:00"}
8ee02abd-ac2a-4f64-9e48-1d6eb905953b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:48:47.262812+00	2025-10-25 05:48:45.066+00	{"expires_at": "2025-10-25T05:53:44.833+00:00"}
5651868d-d132-460e-bc42-e9011ca571c5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:49:47.266612+00	2025-10-25 05:49:45.062+00	{"expires_at": "2025-10-25T05:54:44.841+00:00"}
02f705dc-0b43-489a-8670-cc29c4bfa17d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:50:47.371186+00	2025-10-25 05:50:45.178+00	{"expires_at": "2025-10-25T05:55:44.895+00:00"}
a385459f-5656-4bd5-a656-fdce55f25ff6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:51:47.411454+00	2025-10-25 05:51:45.222+00	{"expires_at": "2025-10-25T05:56:44.838+00:00"}
ec7916c3-7987-47fd-9bb5-7cb239cfdfbd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:52:47.25785+00	2025-10-25 05:52:45.063+00	{"expires_at": "2025-10-25T05:57:44.835+00:00"}
d5087856-830c-4bab-82b1-f0b42fa145bf	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:53:47.19978+00	2025-10-25 05:53:45.004+00	{"expires_at": "2025-10-25T05:58:44.831+00:00"}
fadc9f7d-3b93-42de-83fe-f663bdd3af14	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:54:47.228119+00	2025-10-25 05:54:45.029+00	{"expires_at": "2025-10-25T05:59:44.834+00:00"}
257d1091-6e47-4d7f-a5f1-f5ea1b6e924e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:55:47.241354+00	2025-10-25 05:55:45.044+00	{"expires_at": "2025-10-25T06:00:44.835+00:00"}
a4f7fcea-40f0-4b24-a21e-d0081841c7ce	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:56:47.329962+00	2025-10-25 05:56:45.133+00	{"expires_at": "2025-10-25T06:01:44.878+00:00"}
ee32fd11-e75c-42ef-8012-af5da9282b80	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:57:47.253732+00	2025-10-25 05:57:45.039+00	{"expires_at": "2025-10-25T06:02:44.84+00:00"}
cd5266ae-8359-424d-b8df-24382308cbe9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:58:47.266972+00	2025-10-25 05:58:45.055+00	{"expires_at": "2025-10-25T06:03:44.838+00:00"}
33d7f798-e674-42c9-a0fb-0f94404e1b94	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 05:59:47.255335+00	2025-10-25 05:59:45.047+00	{"expires_at": "2025-10-25T06:04:44.829+00:00"}
5ded9ef6-20dc-4edb-8926-c820271aca10	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:00:47.385431+00	2025-10-25 06:00:45.178+00	{"expires_at": "2025-10-25T06:05:44.881+00:00"}
0b92b22f-dae3-4cbc-95d9-38acd41743c3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:01:47.683546+00	2025-10-25 06:01:45.431+00	{"expires_at": "2025-10-25T06:06:44.879+00:00"}
e32c08ca-0d6b-4912-9f3f-312a4e0f6661	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:02:47.452065+00	2025-10-25 06:02:45.211+00	{"expires_at": "2025-10-25T06:07:44.866+00:00"}
6e4f601c-7ee8-4df1-98b4-f286e29c0e7e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:03:47.405138+00	2025-10-25 06:03:45.154+00	{"expires_at": "2025-10-25T06:08:44.878+00:00"}
d54af44a-6804-4b53-98c7-06825538d929	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:04:47.393019+00	2025-10-25 06:04:45.152+00	{"expires_at": "2025-10-25T06:09:44.867+00:00"}
0e0f3bdd-df7d-4bf2-b6ba-8e3a34489c86	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:05:47.404185+00	2025-10-25 06:05:45.161+00	{"expires_at": "2025-10-25T06:10:44.863+00:00"}
a670cae2-200e-4a9d-9922-7e7c6e6d4842	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:06:47.416535+00	2025-10-25 06:06:45.182+00	{"expires_at": "2025-10-25T06:11:44.87+00:00"}
ecb9c890-587d-474f-bb75-48879f2dc423	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:07:47.488639+00	2025-10-25 06:07:45.225+00	{"expires_at": "2025-10-25T06:12:44.964+00:00"}
584bcde5-ebfe-4f19-ad79-5082fa807bdb	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:08:47.356747+00	2025-10-25 06:08:45.131+00	{"expires_at": "2025-10-25T06:13:44.936+00:00"}
d67ef775-7030-4e4e-b04c-03e51aecf755	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:09:47.380408+00	2025-10-25 06:09:45.146+00	{"expires_at": "2025-10-25T06:14:44.926+00:00"}
a45af9ed-5187-4ecd-9483-2faab276585f	unknown	logout	\N	2025-10-25 06:10:43.87383+00	2025-10-25 06:10:41.514+00	\N
c47d931c-e9c4-41e2-83d6-b97c7c3e6689	kmiko28@gmail.com	login	\N	2025-10-25 06:11:28.344103+00	2025-10-25 06:11:25.912+00	\N
8d6c5ad7-39c9-4c28-a18e-e3429d4a9a03	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 06:11:32.898595+00	2025-10-25 06:11:30.644+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
91ac5810-85ef-44c8-92e0-e90ac18a2f84	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:11:33.24051+00	2025-10-25 06:11:30.992+00	{"expires_at": "2025-10-25T06:16:30.783+00:00"}
4ea73929-6e86-4c18-a5d7-ac61dd8869ae	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 06:11:54.04971+00	2025-10-25 06:11:51.776+00	{"stage": "draft", "changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"]}
9411d486-a0c1-4701-85a3-43b926c10fa4	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 06:11:55.700179+00	2025-10-25 06:11:53.452+00	{"changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T06:11:53.390Z"}
d841d8c5-e467-4548-bd71-cfd646e5e06e	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 06:11:56.013024+00	2025-10-25 06:11:53.744+00	\N
85e82c61-b508-4c7c-bdba-86e5e27cc3c7	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 06:12:02.93631+00	2025-10-25 06:12:00.696+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
01b913ce-3fef-484a-984e-98f4c5a5aab2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:12:03.171332+00	2025-10-25 06:12:00.93+00	{"expires_at": "2025-10-25T06:17:00.786+00:00"}
a28e4a9a-ef55-40a5-b8c7-2254e851f32b	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 06:12:11.333853+00	2025-10-25 06:12:09.091+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": ""}}, "changedKeys": ["logo_url"]}
e281b684-2619-471c-8895-0accb35bbf09	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 06:12:13.881918+00	2025-10-25 06:12:11.637+00	\N
c7bec8a3-7a3d-4f87-94af-a0ebc12bee9f	kmiko28@gmail.com	login	\N	2025-10-25 07:28:16.613295+00	2025-10-25 07:28:14.06+00	\N
0a171302-2989-41aa-a4d7-bd9ce2e68a62	kmiko28@gmail.com	logout	\N	2025-11-28 21:07:32.183011+00	2025-11-28 21:07:31.005+00	\N
9e1c6dae-d4d2-4492-b63f-19d9649bc9e2	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 06:12:13.470283+00	2025-10-25 06:12:11.226+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": ""}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T06:12:11.152Z"}
ed9c89ee-681a-47da-969f-d56f500d4c87	kmiko28@gmail.com	media.delete	\N	2025-10-25 06:12:48.458243+00	2025-10-25 06:12:46.184+00	{"path": "1761358744788_TooFunny.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761358744788_TooFunny.png"}
44a43ae7-ac0e-498e-8a35-0809d6cf3d5c	kmiko28@gmail.com	login	\N	2025-10-25 06:30:45.762981+00	2025-10-25 06:30:43.381+00	\N
d37a5fae-b7c4-4e56-9afe-2520cec5e58a	kmiko28@gmail.com	login	\N	2025-10-25 06:31:31.53225+00	2025-10-25 06:31:29.196+00	\N
6fb5f6e9-d87c-493f-b6ce-b1576420e848	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 06:31:34.220886+00	2025-10-25 06:31:31.917+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
fb58fb4a-b538-4548-ac32-e1d0c3c324b2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:31:34.533295+00	2025-10-25 06:31:32.234+00	{"expires_at": "2025-10-25T06:36:32.046+00:00"}
0ac566e0-dd7c-44fb-a956-b33929994381	kmiko28@gmail.com	media.rename	\N	2025-10-25 06:31:57.796904+00	2025-10-25 06:31:55.494+00	{"newUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "toPath": "TooFunny.png", "fromPath": "1761350375464_TooFunny.png"}
d35ac6e8-8e66-4783-8d9a-8f783ff852c8	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 06:32:18.818319+00	2025-10-25 06:32:16.519+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
eb64e105-5da3-4114-80fe-d580df2f520b	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 06:32:33.380365+00	2025-10-25 06:32:31.064+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url", "favicon_url"]}
06fdbc3f-1c24-4d28-a103-ca7641dec957	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 06:32:34.772377+00	2025-10-25 06:32:32.427+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}}, "changedKeys": ["logo_url", "favicon_url"], "published_at": "2025-10-25T06:32:32.301Z"}
4c1e8a56-fb08-446a-bf6c-8bf7fd0c3422	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:32:34.83696+00	2025-10-25 06:32:32.528+00	{"expires_at": "2025-10-25T06:37:32.331+00:00"}
0532ffbb-a47b-4aa2-987b-36caf23e4bbd	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 06:32:35.088134+00	2025-10-25 06:32:32.788+00	\N
0c6aba24-787f-4770-aefe-f67220ad32eb	kmiko28@gmail.com	login	\N	2025-10-25 06:40:08.074068+00	2025-10-25 06:40:05.7+00	\N
6b8375fc-5e91-495a-8ae2-542f5bb7bb15	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 06:40:12.82988+00	2025-10-25 06:40:10.494+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
af5800c8-fb36-401e-8a00-5db4335547a5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:40:13.062662+00	2025-10-25 06:40:10.726+00	{"expires_at": "2025-10-25T06:45:10.59+00:00"}
306f218a-6a2a-4845-a72f-13690ae46859	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 06:40:15.40871+00	2025-10-25 06:40:13.071+00	{"stage": "draft", "changed": {"logo_url": {"after": "", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"]}
997cde6b-47c3-4974-a8a8-4cbbf9339eb9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:41:13.403723+00	2025-10-25 06:41:11.068+00	{"expires_at": "2025-10-25T06:46:10.868+00:00"}
8873835c-d519-43c1-bb8d-b53be7912608	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:42:13.438874+00	2025-10-25 06:42:11.105+00	{"expires_at": "2025-10-25T06:47:10.875+00:00"}
048b180c-0e14-4feb-a02b-9450ad6c6171	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:43:13.947308+00	2025-10-25 06:43:11.571+00	{"expires_at": "2025-10-25T06:48:10.87+00:00"}
3a3e2f54-296e-4b54-a1fa-c3afa06273a0	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:44:13.591957+00	2025-10-25 06:44:11.241+00	{"expires_at": "2025-10-25T06:49:10.929+00:00"}
e5e7e9c9-05e0-4201-91f8-21e7778b28b7	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:45:13.571189+00	2025-10-25 06:45:11.199+00	{"expires_at": "2025-10-25T06:50:10.911+00:00"}
d92e2f24-2d42-4ab8-850a-a933a5353b69	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:46:13.515736+00	2025-10-25 06:46:11.164+00	{"expires_at": "2025-10-25T06:51:10.894+00:00"}
4873216c-c889-427d-b9cd-bbf44fd4fa33	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:47:13.516041+00	2025-10-25 06:47:11.132+00	{"expires_at": "2025-10-25T06:52:10.877+00:00"}
f0eece49-f254-41ae-bce2-ab33e44f247f	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 06:48:13.503794+00	2025-10-25 06:48:11.142+00	{"expires_at": "2025-10-25T06:53:10.873+00:00"}
8f70d3bc-f1ce-4376-a976-1bdc5def7d30	kmiko28@gmail.com	logout	\N	2025-10-25 06:49:00.888332+00	2025-10-25 06:48:58.42+00	\N
fc42a2ea-ac11-4829-a7a7-ba452cba9ac4	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 07:28:19.623255+00	2025-10-25 07:28:17.17+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
b1494adc-7f88-4a5e-8a43-3063a846e2f0	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 07:28:29.898976+00	2025-10-25 07:28:27.436+00	\N
37ca5e21-600f-4bbf-b2e4-2eb21e37764e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 07:28:20.018878+00	2025-10-25 07:28:17.578+00	{"expires_at": "2025-10-25T07:33:17.327+00:00"}
0081038c-e538-44e7-b076-e6d11b990c53	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 07:28:29.561881+00	2025-10-25 07:28:27.093+00	{"changed": {}, "changedKeys": [], "published_at": "2025-10-25T07:28:27.028Z"}
18bd203e-ee4f-4e58-8585-05afd02dced6	kmiko28@gmail.com	logout	\N	2025-10-25 07:34:51.916658+00	2025-10-25 07:34:49.383+00	\N
7baae308-d1b0-405f-9f75-d145e5a9b2f9	kmiko28@gmail.com	login	\N	2025-10-25 08:14:51.611632+00	2025-10-25 08:14:48.923+00	\N
c0bede0d-9194-4d88-abcd-f5dd0546e521	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 08:14:54.646867+00	2025-10-25 08:14:52.061+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
8f79e1bc-af62-4357-a4aa-3a979aacc458	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:14:55.189428+00	2025-10-25 08:14:52.602+00	{"expires_at": "2025-10-25T08:19:52.233+00:00"}
f12cb895-60e5-4b57-8985-7854ac98c179	kmiko28@gmail.com	media.upload	\N	2025-10-25 08:15:18.236506+00	2025-10-25 08:15:15.64+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg", "path": "1761380115386_D&D.jpg", "size": 37486, "mimetype": "image/jpeg", "originalName": "D&D.jpg"}
3dbcccac-97de-417f-bba6-08d1a6f66af9	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 08:15:20.344188+00	2025-10-25 08:15:17.779+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"]}
e03f58ff-2961-41f7-8fdc-4db6939182f7	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 08:15:21.783106+00	2025-10-25 08:15:19.215+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T08:15:19.138Z"}
4d06575b-02d9-4144-85d5-e5e15c5e41f1	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 08:15:22.083736+00	2025-10-25 08:15:19.523+00	\N
1e123f30-5aee-4e31-a24f-7d1e6492db07	kmiko28@gmail.com	logout	\N	2025-10-25 08:23:18.233932+00	2025-10-25 08:23:15.258+00	\N
61178266-398f-4f97-8178-440a57b787f4	kmiko28@gmail.com	login	\N	2025-10-25 08:38:09.159695+00	2025-10-25 08:38:06.221+00	\N
7a9665c9-8409-46f4-b764-fabce30fd38a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 08:38:28.032971+00	2025-10-25 08:38:25.38+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
ffeb7639-2687-4a35-b7e1-9be99e667c0a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:38:28.499959+00	2025-10-25 08:38:25.851+00	{"expires_at": "2025-10-25T08:43:25.537+00:00"}
242051c8-c165-4c34-9064-64e5f7a6dce5	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 08:38:39.637933+00	2025-10-25 08:38:37.012+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg"}}, "changedKeys": ["logo_url"]}
8f060c2d-c3ad-4033-90a8-4b0486afb997	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 08:38:40.526392+00	2025-10-25 08:38:37.902+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T08:38:37.836Z"}
439248f6-5145-436b-ba3e-9500191c072f	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 08:38:40.860102+00	2025-10-25 08:38:38.241+00	\N
8055c3d6-69d7-4fe9-9ce8-f0011c56205c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 08:39:12.472384+00	2025-10-25 08:39:09.841+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
570c1dbd-8349-4250-9e6a-0f2692579004	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:39:12.726634+00	2025-10-25 08:39:10.095+00	{"expires_at": "2025-10-25T08:44:09.932+00:00"}
a004214f-ab3e-4cb8-b7a1-32a15d71a6fa	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 08:39:19.601241+00	2025-10-25 08:39:16.97+00	{"stage": "draft", "changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}}, "changedKeys": ["hero_image_url"]}
3bf92b7c-690e-48ce-8aac-1eaae8c2d7a2	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 08:39:21.477211+00	2025-10-25 08:39:18.845+00	{"changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}}, "changedKeys": ["hero_image_url"], "published_at": "2025-10-25T08:39:18.750Z"}
503beb04-fad8-49bd-b1e8-e444bf5d6ba2	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 08:39:21.82017+00	2025-10-25 08:39:19.158+00	\N
f9dd2658-58ee-4616-adbc-fa6a0cc5975e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:39:31.903005+00	2025-10-25 08:39:29.264+00	{"expires_at": "2025-10-25T08:44:29.126+00:00"}
d7ce52e7-30f9-444c-8946-1e4f8870e8f4	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 08:39:37.258531+00	2025-10-25 08:39:34.627+00	\N
20521178-74f0-49c4-89d0-c23c9aae9daf	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:39:44.721421+00	2025-10-25 08:39:42.092+00	{"expires_at": "2025-10-25T08:44:41.947+00:00"}
f7502138-50cd-49e5-ae59-38c8fa1e2c93	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 08:39:31.65027+00	2025-10-25 08:39:29.025+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
0a683412-1e88-407f-99eb-807dec5d0286	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 08:39:36.641478+00	2025-10-25 08:39:34.009+00	{"stage": "draft", "changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg"}}, "changedKeys": ["hero_image_url"]}
20b62691-6fb6-4a50-b9ea-c8d38164b2f2	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 08:39:44.49253+00	2025-10-25 08:39:41.864+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
6e54b7f4-3f63-4fca-817e-b1fe8aff82b4	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 08:39:36.974899+00	2025-10-25 08:39:34.346+00	{"changed": {"hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg"}}, "changedKeys": ["hero_image_url"], "published_at": "2025-10-25T08:39:34.292Z"}
a224beb2-55dc-4721-8308-29558402e0c9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:40:44.995509+00	2025-10-25 08:40:42.354+00	{"expires_at": "2025-10-25T08:45:42.196+00:00"}
560d46ae-a07c-4c40-bdcd-abce9ca02d6a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:41:45.085262+00	2025-10-25 08:41:42.428+00	{"expires_at": "2025-10-25T08:46:42.225+00:00"}
fab52969-2cda-46a1-955c-b93eeb9eb76d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:42:45.132404+00	2025-10-25 08:42:42.454+00	{"expires_at": "2025-10-25T08:47:42.234+00:00"}
b0ab75f4-9bd7-40d0-9f2b-62424d9a0559	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:43:45.288844+00	2025-10-25 08:43:42.629+00	{"expires_at": "2025-10-25T08:48:42.255+00:00"}
26a67820-ffbc-4ba4-977f-852fd1787356	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:44:45.052427+00	2025-10-25 08:44:42.389+00	{"expires_at": "2025-10-25T08:49:42.22+00:00"}
3368da68-48e1-4c6b-be17-0bfbca46efd3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 08:45:45.337033+00	2025-10-25 08:45:42.649+00	{"expires_at": "2025-10-25T08:50:42.245+00:00"}
613bde98-5bbf-41bc-b049-c66a52e7f277	kmiko28@gmail.com	logout	\N	2025-10-25 08:46:20.095208+00	2025-10-25 08:46:17.343+00	\N
3de1a0bb-fffe-4dbc-800a-a80d50b1959e	toofunnysketch@gmail.com	login	\N	2025-10-25 15:30:36.712289+00	2025-10-25 15:30:36.539+00	\N
cf24c7d1-03cd-4ec4-9b48-c1444f9816b5	toofunnysketch@gmail.com	media.delete	\N	2025-10-25 15:37:41.574858+00	2025-10-25 15:37:41.434+00	{"path": "1761380115386_D&D.jpg", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761380115386_D&D.jpg"}
048ba46c-6017-4bfd-b066-746bfbee2f02	kmiko28@gmail.com	login	\N	2025-10-25 16:03:02.178248+00	2025-10-25 16:03:01.62+00	\N
e4e71d05-7389-40c8-bbca-e2621ea66efe	toofunnysketch@gmail.com	logout	\N	2025-10-25 16:36:41.48095+00	2025-10-25 16:36:40.864+00	\N
02b280eb-3bfa-49ec-b17f-71f139a4d3b4	kmiko28@gmail.com	login	\N	2025-10-25 18:11:40.611687+00	2025-10-25 18:11:40.036+00	\N
a46ac2c7-1ec9-49f0-bc02-fc7536c0f854	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 18:12:10.45991+00	2025-10-25 18:12:09.976+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
7a98de21-a422-4f70-a96d-02837a2a4645	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:12:10.884739+00	2025-10-25 18:12:10.412+00	{"expires_at": "2025-10-25T18:17:10.098+00:00"}
c4834cd9-d040-4361-bba3-051368178feb	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:13:12.227357+00	2025-10-25 18:13:11.73+00	{"expires_at": "2025-10-25T18:18:11.535+00:00"}
b67ac5dc-4463-4cae-9889-0194063879d6	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 18:13:54.986272+00	2025-10-25 18:13:54.461+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"]}
82066d8d-f35c-4706-acff-1f1132cc9469	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 18:13:56.130852+00	2025-10-25 18:13:55.638+00	{"changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"], "published_at": "2025-10-25T18:13:55.554Z"}
2d960374-81ae-4037-81dd-b2f1cd2a6050	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 18:13:56.617548+00	2025-10-25 18:13:56.103+00	\N
489c8628-8e3b-402d-b287-32f79156ad70	kmiko28@gmail.com	login	\N	2025-10-25 18:23:05.270839+00	2025-10-25 18:23:04.767+00	\N
7f4196d5-f9cb-4fa6-998b-b28d7616e386	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:39:50.488659+00	2025-10-25 23:39:49.16+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"]}
f98000c5-217e-46fc-a1d9-4a18c80c0228	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:29:07.686422+00	2025-10-26 17:29:07.032+00	{"expires_at": "2025-10-26T17:34:06.805+00:00"}
88fa7a55-a655-4316-b068-97cda732a738	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:31:08.049999+00	2025-10-26 17:31:07.373+00	{"expires_at": "2025-10-26T17:36:07.153+00:00"}
3e0df4be-2e0b-480e-a089-0fe367629d92	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:33:08.056957+00	2025-10-26 17:33:07.371+00	{"expires_at": "2025-10-26T17:38:07.155+00:00"}
1021a6cf-3b95-44bf-a91d-17d373b8d50d	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 18:24:23.47899+00	2025-10-25 18:24:22.977+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
f8f668ee-564d-4647-8299-72d2f78f3e73	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:24:23.916633+00	2025-10-25 18:24:23.419+00	{"expires_at": "2025-10-25T18:29:23.248+00:00"}
4fbc6f57-72f0-4a72-a9d0-1d68bcbb17f4	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 18:24:27.356897+00	2025-10-25 18:24:26.856+00	{"stage": "draft", "changed": {}, "changedKeys": []}
072cb401-1843-4fd5-bf93-c4f05176b848	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 18:25:10.558471+00	2025-10-25 18:25:10.014+00	{"stage": "draft", "changed": {}, "changedKeys": []}
d84a4b63-d626-4aec-846e-ed23fd6a1458	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:25:24.217027+00	2025-10-25 18:25:23.706+00	{"expires_at": "2025-10-25T18:30:23.535+00:00"}
d0702c36-8241-4e16-b76b-c39f3b8ad2c2	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:26:24.278714+00	2025-10-25 18:26:23.757+00	{"expires_at": "2025-10-25T18:31:23.544+00:00"}
6474f355-fd62-45fa-bc58-e8d024e6351d	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 18:27:22.119503+00	2025-10-25 18:27:21.622+00	\N
6531d81f-177d-491e-86b5-23f244e06034	kmiko28@gmail.com	login	\N	2025-10-25 18:32:43.012445+00	2025-10-25 18:32:42.449+00	\N
b27142e4-f7d7-4213-b014-a1d08ce383aa	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 18:32:56.528074+00	2025-10-25 18:32:56.001+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
e97b0e01-41ad-43ca-9acb-fd21e3110343	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:32:56.751274+00	2025-10-25 18:32:56.24+00	{"expires_at": "2025-10-25T18:37:56.122+00:00"}
934fde18-6da0-43ae-af66-a00b75dc8155	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 18:33:57.203125+00	2025-10-25 18:33:56.67+00	{"expires_at": "2025-10-25T18:38:56.393+00:00"}
376a3170-1cb7-4e18-9819-9e0b24673c73	unknown	logout	\N	2025-10-25 18:40:41.658481+00	2025-10-25 18:40:40.579+00	\N
5bd0b16b-08b4-45e8-8712-3706b98b153a	kmiko28@gmail.com	login	\N	2025-10-25 18:44:33.678099+00	2025-10-25 18:44:33.011+00	\N
5b053cbe-08b3-481d-acb1-ef4f857aebff	kmiko28@gmail.com	contact_response_update	\N	2025-10-25 18:44:41.963975+00	2025-10-25 18:44:41.414+00	{"id": "22c0a389-b43b-4c21-9fad-e202ec0ad9e8", "hasNotes": false, "responded": true}
be931f45-20b4-40be-98e2-74c4460aaa37	kmiko28@gmail.com	contact_response_update	\N	2025-10-25 18:44:44.957507+00	2025-10-25 18:44:44.415+00	{"id": "c8b1e599-ee34-4629-bb18-98c62b4a6871", "hasNotes": false, "responded": true}
894bbfb6-64c7-4348-a717-5502dc09172d	kmiko28@gmail.com	login	\N	2025-10-25 18:47:31.369002+00	2025-10-25 18:47:30.634+00	\N
a27f89c7-8c1b-437b-8986-9c4db0b704b2	kmiko28@gmail.com	login	\N	2025-10-25 19:07:30.597885+00	2025-10-25 19:07:29.902+00	\N
cdad0b48-b16a-4bfe-94bc-cf9e42c9e85a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 19:07:33.908195+00	2025-10-25 19:07:33.304+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
cef7f15e-4bff-4859-a763-a5995a053fc4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 19:07:34.278066+00	2025-10-25 19:07:33.622+00	{"expires_at": "2025-10-25T19:12:33.418+00:00"}
2f31b832-80f5-4930-8691-a30caab90756	kmiko28@gmail.com	media.upload	\N	2025-10-25 19:07:45.721579+00	2025-10-25 19:07:45.087+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png", "path": "1761419264594_TFP.png", "size": 344540, "mimetype": "image/png", "originalName": "TFP.png"}
a7e4b854-f183-4be6-b275-c194416cf719	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 19:07:47.866991+00	2025-10-25 19:07:47.268+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"]}
78542933-1640-47db-8312-fc473cb38d0f	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 19:07:49.816134+00	2025-10-25 19:07:49.221+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T19:07:49.163Z"}
d9e288f4-ff3a-47d6-9486-53c179e4bea2	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 19:07:50.113182+00	2025-10-25 19:07:49.514+00	\N
87c5bdd1-6486-4a7d-816b-d95bdb479dc4	kmiko28@gmail.com	media.rename	\N	2025-10-25 19:08:50.690857+00	2025-10-25 19:08:50.082+00	{"newUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png", "toPath": "TFPLOGO", "fromPath": "1761419264594_TFP.png"}
35f5d608-4afa-4bbb-9eaa-ee7921697306	kmiko28@gmail.com	login	\N	2025-10-25 19:10:50.300903+00	2025-10-25 19:10:49.627+00	\N
d3e34059-68f1-4a33-a48e-8618ac2ec380	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-26 01:01:04.844923+00	2025-10-26 01:01:03.298+00	{"changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}]}}, "changedKeys": ["media_sections"], "published_at": "2025-10-26T01:01:03.215Z"}
775a76ba-debb-4a51-a5e2-34e8683a677c	kmiko28@gmail.com	allowlist_update	\N	2025-10-26 17:29:27.940421+00	2025-10-26 17:29:27.246+00	{"count": 3}
cdfd2c51-7ee7-45eb-ac0c-141af136fceb	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 19:11:00.24168+00	2025-10-25 19:10:59.623+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
4e2c2e41-9a95-4476-acf2-ab2ae1623eae	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 19:11:00.542432+00	2025-10-25 19:10:59.929+00	{"expires_at": "2025-10-25T19:15:59.776+00:00"}
5d96d77e-28b0-4a83-aea1-a996e57aabae	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 19:11:32.854853+00	2025-10-25 19:11:32.232+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "before": []}}, "changedKeys": ["admin_quick_links"]}
be286bb6-8eb1-418d-aa44-17343724ed8e	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 19:11:33.747511+00	2025-10-25 19:11:33.125+00	{"changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "before": []}}, "changedKeys": ["admin_quick_links"], "published_at": "2025-10-25T19:11:33.050Z"}
4a11b462-cff4-45b3-a360-e016b9457b83	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 19:11:34.092783+00	2025-10-25 19:11:33.469+00	\N
7f2265c3-7b38-4bfe-a7ce-fbd1f2a50490	kmiko28@gmail.com	logout	\N	2025-10-25 19:20:02.28701+00	2025-10-25 19:20:01.431+00	\N
d318311a-943c-470c-bd45-a8ac4a4c35a0	kmiko28@gmail.com	login	\N	2025-10-25 23:38:49.841586+00	2025-10-25 23:38:48.403+00	\N
ee06cf61-5fd9-4e0d-9698-193b0c4dfbc4	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:38:59.97752+00	2025-10-25 23:38:58.653+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
c7c171ee-0431-414f-b850-3bebd307aab6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:39:00.314321+00	2025-10-25 23:38:59.001+00	{"expires_at": "2025-10-25T23:43:58.808+00:00"}
efbc973b-9697-477b-8a7c-290ae131702c	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:39:09.68874+00	2025-10-25 23:39:08.356+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png"}}, "changedKeys": ["logo_url"]}
99b8f188-b855-4602-bfca-09d7aabb1c3a	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 23:39:10.864786+00	2025-10-25 23:39:09.523+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761419264594_TFP.png"}}, "changedKeys": ["logo_url"], "published_at": "2025-10-25T23:39:09.391Z"}
a4f9a22e-db11-4e03-8586-cb39af596637	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 23:39:11.27987+00	2025-10-25 23:39:09.973+00	\N
7abff597-a20a-44d5-b4e8-6ce2f2979fbe	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:39:18.867614+00	2025-10-25 23:39:17.56+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
349625de-fc92-4097-b688-847049f3857e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:39:19.142315+00	2025-10-25 23:39:17.828+00	{"expires_at": "2025-10-25T23:44:17.672+00:00"}
39671878-8e3e-49a5-b912-4a76fc6d9cef	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:39:28.521409+00	2025-10-25 23:39:27.207+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348978901_TooFunny.png"}}, "changedKeys": ["logo_url"]}
a1f655bf-08a0-4b71-8382-bf551cbf6e4d	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 23:39:29.785904+00	2025-10-25 23:39:28.47+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}, "about_team": {"after": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png"}, "admin_quick_links": {"after": [], "before": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]}}, "changedKeys": ["logo_url", "favicon_url", "hero_image_url", "about_team", "admin_quick_links"], "published_at": "2025-10-25T23:39:28.402Z"}
4a857287-4a00-47cb-86ea-844433b07697	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 23:39:30.102451+00	2025-10-25 23:39:28.786+00	\N
a5c71072-c85a-429c-a3e3-26b7ae677f51	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:39:38.83319+00	2025-10-25 23:39:37.508+00	{"expires_at": "2025-10-25T23:44:37.354+00:00"}
8eb9d841-78e1-4504-ae33-7317d930c8a9	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:39:38.536817+00	2025-10-25 23:39:37.194+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
fc2f0bb9-37a1-4fbe-842d-62fc2de63d3d	kmiko28@gmail.com	settings.lock.release	\N	2025-10-25 23:39:54.877086+00	2025-10-25 23:39:53.554+00	\N
e4a1e68f-e4ad-41a3-b2ab-ad0c4523f75a	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-25 23:39:54.509878+00	2025-10-25 23:39:53.177+00	{"changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}, "about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Bio", "name": "Donovan", "title": "Everything", "socials": {"tiktok": "TT", "twitter": "X", "website": "Site", "youtube": "YT", "instagram": "IG"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}, "favicon_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761350375464_TooFunny.png"}, "hero_image_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761348980373_TooFunny.png"}, "admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "before": []}}, "changedKeys": ["logo_url", "favicon_url", "hero_image_url", "about_team", "admin_quick_links"], "published_at": "2025-10-25T23:39:53.100Z"}
2e27daff-2c09-4311-a2d2-fa2b61b3a30b	kmiko28@gmail.com	login	\N	2025-10-25 23:42:37.546292+00	2025-10-25 23:42:36.178+00	\N
894229e6-47fd-490a-a2e0-c5b16ef45caa	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:42:48.498451+00	2025-10-25 23:42:47.166+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
33f79dc8-4b95-4165-b7f8-996e0f3a4f62	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:42:48.793813+00	2025-10-25 23:42:47.48+00	{"expires_at": "2025-10-25T23:47:47.286+00:00"}
8cac0fa9-df43-4823-aa91-d6adad7e182c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:43:49.274911+00	2025-10-25 23:43:47.951+00	{"expires_at": "2025-10-25T23:48:47.61+00:00"}
4e6aa71d-fd30-4f5e-9705-ec1bac26f47d	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:44:49.173613+00	2025-10-25 23:44:47.83+00	{"expires_at": "2025-10-25T23:49:47.613+00:00"}
aaceff54-a68a-4d19-8366-709d7659d442	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:45:49.148149+00	2025-10-25 23:45:47.813+00	{"expires_at": "2025-10-25T23:50:47.613+00:00"}
def9f9a9-1e7d-4806-834f-db997c9038f7	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:46:49.187958+00	2025-10-25 23:46:47.834+00	{"expires_at": "2025-10-25T23:51:47.597+00:00"}
07f243cd-9047-40ef-b8cc-b827f71d6b7c	unknown	logout	\N	2025-10-25 23:47:40.00941+00	2025-10-25 23:47:38.58+00	\N
82ca2c03-9c3e-49dd-a3aa-a91b936e5e3b	kmiko28@gmail.com	login	\N	2025-10-25 23:47:57.970882+00	2025-10-25 23:47:56.595+00	\N
2c399ae3-5848-49d0-baa5-e8e76817c3c0	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:48:06.779762+00	2025-10-25 23:48:05.434+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
62b0aecf-e0a2-46b1-8d19-743c15c7b380	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:48:07.033455+00	2025-10-25 23:48:05.698+00	{"expires_at": "2025-10-25T23:53:05.542+00:00"}
5598f7c0-76b7-4d23-a18f-4254bdd8391e	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:48:19.44834+00	2025-10-25 23:48:18.102+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNYd", "before": "Comedy That's TOO FUNNY"}}, "changedKeys": ["hero_title"]}
111049a2-0d0f-4051-b953-0709b10ddb52	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:48:22.760912+00	2025-10-25 23:48:21.427+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
4745d63b-0d97-47a9-9845-3e7655003761	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:48:25.105566+00	2025-10-25 23:48:23.763+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNYf", "before": "Comedy That's TOO FUNNY"}}, "changedKeys": ["hero_title"]}
2ac2b320-7bb1-4159-9cd5-78ded7514ab0	kmiko28@gmail.com	settings.version.create	\N	2025-10-25 23:48:38.898937+00	2025-10-25 23:48:37.569+00	{"label": "d", "stage": "draft", "snapshotKeys": ["site_title", "site_description", "site_keywords", "logo_url", "favicon_url", "footer_text", "hero_title", "hero_subtext", "hero_image_url", "featured_video_url", "contactemail", "contactphone", "maintenance_enabled", "maintenance_message", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "contact_socials", "theme_accent", "theme_bg", "footer_links", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
2cb61aa8-9c02-494f-b903-e6426f64927d	kmiko28@gmail.com	settings.version.delete	\N	2025-10-25 23:49:09.292354+00	2025-10-25 23:49:07.954+00	{"label": "d", "stage": "draft", "versionId": "13c66797-59a1-49a7-b3f9-adf61af62816"}
01271035-1465-4d54-9a67-14919ca435ab	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 01:01:05.261444+00	2025-10-26 01:01:03.713+00	\N
d3a6fa69-3bbc-4361-8e02-d66984baec6d	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:48:43.678973+00	2025-10-25 23:48:42.351+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
3a3c49a9-12e3-42bf-8b77-1467b521b76a	kmiko28@gmail.com	settings.update.draft	\N	2025-10-25 23:48:45.604103+00	2025-10-25 23:48:44.269+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNYd", "before": "Comedy That's TOO FUNNY"}}, "changedKeys": ["hero_title"]}
0ac3f1f0-b2d1-402a-bdc3-cf5306cae576	kmiko28@gmail.com	settings.version.create	\N	2025-10-25 23:48:50.419106+00	2025-10-25 23:48:49.089+00	{"label": "f", "stage": "draft", "snapshotKeys": ["site_title", "site_description", "site_keywords", "logo_url", "favicon_url", "footer_text", "hero_title", "hero_subtext", "hero_image_url", "featured_video_url", "contactemail", "contactphone", "maintenance_enabled", "maintenance_message", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "contact_socials", "theme_accent", "theme_bg", "footer_links", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
438a751b-1424-4b0e-8020-b60bb12ec917	kmiko28@gmail.com	settings.version.delete	\N	2025-10-25 23:49:07.416487+00	2025-10-25 23:49:06.034+00	{"label": "f", "stage": "draft", "versionId": "f591b36b-76c1-4b2e-97f7-41fbccfa601a"}
481af55a-f518-47f9-84d8-a3f8e958cd2b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:49:07.484374+00	2025-10-25 23:49:06.147+00	{"expires_at": "2025-10-25T23:54:05.974+00:00"}
8d9b55a7-0d08-4e75-a6a9-2c3bf1f29c4d	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-25 23:49:12.793163+00	2025-10-25 23:49:11.463+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
970210ad-9f5a-4c63-970e-b696e23c35f5	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-25 23:50:07.380695+00	2025-10-25 23:50:06.033+00	{"expires_at": "2025-10-25T23:55:05.841+00:00"}
35908ba1-5116-4b19-8cca-a57b2d53b747	kmiko28@gmail.com	login	\N	2025-10-25 23:52:49.857577+00	2025-10-25 23:52:48.458+00	\N
63498b81-0654-48ee-971c-2476a53dab13	unknown	logout	\N	2025-10-25 23:55:18.225637+00	2025-10-25 23:55:16.306+00	\N
190b298f-69fc-4353-bcd8-27023f463018	kmiko28@gmail.com	login	\N	2025-10-25 23:58:51.994641+00	2025-10-25 23:58:50.454+00	\N
ff29e231-8337-4972-a337-70b68583fd1a	kmiko28@gmail.com	logout	\N	2025-10-26 00:05:26.562562+00	2025-10-26 00:05:25.047+00	\N
72243f5b-d5e1-4ad1-9064-f9727b69d259	kmiko28@gmail.com	login	\N	2025-10-26 00:20:19.762129+00	2025-10-26 00:20:18.349+00	\N
913083dd-03f8-46b4-84d1-8d7e3c38457a	kmiko28@gmail.com	logout	\N	2025-10-26 00:25:34.51624+00	2025-10-26 00:25:32.755+00	\N
a6b30d6b-a242-4925-a35e-5fcb4378c26e	kmiko28@gmail.com	login	\N	2025-10-26 00:45:28.391468+00	2025-10-26 00:45:26.432+00	\N
80415ace-481f-486d-8502-6ec8541f3ff3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 00:47:56.735415+00	2025-10-26 00:47:55.231+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
c73b448f-3d69-4db8-bcf7-0d0699a3a8bf	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 00:47:57.176321+00	2025-10-26 00:47:55.675+00	{"expires_at": "2025-10-26T00:52:55.497+00:00"}
a2a3ce71-b012-458e-9177-53e997043ce0	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 00:48:18.469646+00	2025-10-26 00:48:16.965+00	\N
a217e90e-1770-4d27-96be-40973e78d30c	kmiko28@gmail.com	login	\N	2025-10-26 00:59:51.937481+00	2025-10-26 00:59:50.298+00	\N
7d8c0a4a-9728-44d9-b87f-b42325a87021	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 01:00:39.945809+00	2025-10-26 01:00:38.413+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
3f935f99-5268-4c2d-acd6-e49601e803a9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 01:00:40.26484+00	2025-10-26 01:00:38.717+00	{"expires_at": "2025-10-26T01:05:38.525+00:00"}
7726c3f2-8ef2-4693-8c9f-8a0671271b51	kmiko28@gmail.com	settings.update.draft	\N	2025-10-26 01:01:00.126194+00	2025-10-26 01:00:58.582+00	{"stage": "draft", "changed": {"media_sections": {"after": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "before": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "New Section"}]}}, "changedKeys": ["media_sections"]}
6eab4e60-3680-4ecf-83b1-a5194b56a4c0	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 01:10:45.024485+00	2025-10-26 01:10:43.46+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
fd731403-049c-4b55-bcb3-2a76df6a029a	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 01:10:45.343834+00	2025-10-26 01:10:43.778+00	{"expires_at": "2025-10-26T01:15:43.59+00:00"}
3df680de-86d7-4876-b678-9e5b5488064f	kmiko28@gmail.com	settings.update.draft	\N	2025-10-26 01:11:30.19229+00	2025-10-26 01:11:28.622+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}, {"url": "", "label": ""}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"]}
55e063af-65ce-49f9-ac22-ba4560ed8814	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-26 01:11:33.394307+00	2025-10-26 01:11:31.83+00	{"changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}, {"url": "", "label": ""}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": {"twitter": "https://x.com/donovan2408", "website": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "youtube": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "linktree": "https://linktr.ee/DonovanC", "instagram": "https://www.instagram.com/donovan2408"}, "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"], "published_at": "2025-10-26T01:11:31.733Z"}
041d6e87-08ff-4cc1-8779-422928c60aee	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 01:11:33.788435+00	2025-10-26 01:11:32.217+00	\N
d174f479-1e0a-4532-b991-702ce06288ec	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 01:11:37.00017+00	2025-10-26 01:11:35.432+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
e1d7da59-0841-439c-8845-76e37b063275	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 01:11:37.272632+00	2025-10-26 01:11:35.704+00	{"expires_at": "2025-10-26T01:16:35.54+00:00"}
5311377c-0e22-4336-ba8c-221ccfe6f310	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 01:11:50.2777+00	2025-10-26 01:11:48.69+00	\N
474f339b-0223-47ff-a2ff-8ea0549c7e8a	kmiko28@gmail.com	login	\N	2025-10-26 01:32:02.12364+00	2025-10-26 01:32:00.415+00	\N
7d5d71d1-3e92-494d-9c81-efa59cd304b2	kmiko28@gmail.com	logout	\N	2025-10-26 16:04:49.846026+00	2025-10-26 16:04:45.915+00	\N
3185516c-936e-443d-9035-d208170cbe55	kmiko28@gmail.com	login	\N	2025-10-26 16:04:54.028924+00	2025-10-26 16:04:49.899+00	\N
b576ea6d-360c-4789-9a7e-c94f5358cf01	kmiko28@gmail.com	login	\N	2025-10-26 16:09:47.383645+00	2025-10-26 16:09:47.288+00	\N
0530931e-fb51-4cb8-b906-d75e913d860f	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 16:09:52.274798+00	2025-10-26 16:09:52.207+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
1bc811e0-2408-4fc8-9c9f-7356236a55b4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:09:52.798889+00	2025-10-26 16:09:52.763+00	{"expires_at": "2025-10-26T16:14:52.489+00:00"}
a34cb45d-a6a2-431d-b826-52fe2dba4644	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:10:53.143979+00	2025-10-26 16:10:53.088+00	{"expires_at": "2025-10-26T16:15:52.862+00:00"}
f2554fcd-cd98-49f1-a119-6ae1965adca4	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:11:53.093263+00	2025-10-26 16:11:53.044+00	{"expires_at": "2025-10-26T16:16:52.847+00:00"}
2b11f9a8-fca0-4ef1-9088-71b48c9b66c9	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 16:12:03.853093+00	2025-10-26 16:12:03.794+00	\N
f4692385-0ca8-4232-88ad-4f14d18d61bb	kmiko28@gmail.com	logout	\N	2025-10-26 16:22:57.969754+00	2025-10-26 16:22:57.839+00	\N
fd51f29d-633c-40e7-999d-92b9fa4f71a7	kmiko28@gmail.com	login	\N	2025-10-26 16:37:46.146423+00	2025-10-26 16:37:45.66+00	\N
a0d0d1b9-ddbe-4f25-b474-5af892a248c8	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:37:55.254581+00	2025-10-26 16:37:55.15+00	{"expires_at": "2025-10-26T16:42:54.946+00:00"}
98cca442-0c48-4f4b-998f-d1964f04bbcd	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:30:08.047777+00	2025-10-26 17:30:07.366+00	{"expires_at": "2025-10-26T17:35:07.153+00:00"}
f541d249-ccaa-4e19-ac51-b0c600349dfa	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:32:08.155141+00	2025-10-26 17:32:07.459+00	{"expires_at": "2025-10-26T17:37:07.146+00:00"}
2649fb3a-8ebe-4958-a9b9-c7ef1d0ae84a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 16:37:54.934669+00	2025-10-26 16:37:54.826+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
242930bd-a6de-49dc-bc86-996f28d42808	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:38:55.625153+00	2025-10-26 16:38:55.478+00	{"expires_at": "2025-10-26T16:43:55.259+00:00"}
dcc283a1-5ca7-4f6a-8fdd-98f7af6fa898	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:39:55.736233+00	2025-10-26 16:39:55.584+00	{"expires_at": "2025-10-26T16:44:55.269+00:00"}
4b5cb98f-d643-4f03-9b97-55d6036624b6	kmiko28@gmail.com	login	\N	2025-10-26 16:42:32.042656+00	2025-10-26 16:42:31.44+00	\N
103b94a7-701d-48ce-a2d4-24141807f723	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 16:42:35.671276+00	2025-10-26 16:42:35.125+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
e91ba40f-278e-4b27-b50d-668b8c934c9c	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:42:36.216635+00	2025-10-26 16:42:35.672+00	{"expires_at": "2025-10-26T16:47:35.426+00:00"}
86e698c7-81e8-4dd2-a1f6-b87937fcef1f	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:43:36.483731+00	2025-10-26 16:43:35.939+00	{"expires_at": "2025-10-26T16:48:35.802+00:00"}
d2b7b291-1bbd-4307-ae11-c4375e67ee0e	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:44:36.774218+00	2025-10-26 16:44:36.211+00	{"expires_at": "2025-10-26T16:49:35.791+00:00"}
c0947dfe-b2da-45d7-81ac-5c316bb605f9	kmiko28@gmail.com	settings.update.draft	\N	2025-10-26 16:44:59.844811+00	2025-10-26 16:44:59.296+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}, {"url": "", "label": ""}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"]}
5a819e1c-6735-4ab1-b3c1-031868bac502	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-26 16:45:04.316902+00	2025-10-26 16:45:03.748+00	{"changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}, {"url": "", "label": ""}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}]}}, "changedKeys": ["about_team"], "published_at": "2025-10-26T16:45:03.644Z"}
4ac0ba11-e3dc-4310-868f-9167d698b37e	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 16:45:04.708169+00	2025-10-26 16:45:04.159+00	\N
40201ce1-399c-49b4-b486-20a51bcb7a2b	kmiko28@gmail.com	media.delete	\N	2025-10-26 16:49:41.898235+00	2025-10-26 16:49:41.314+00	{"path": "1761071405742_2+chairs_.png", "oldUrl": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761071405742_2+chairs_.png"}
3fb76f50-bdf6-4920-bffc-2b1d8d9854e1	kmiko28@gmail.com	login	\N	2025-10-26 16:51:37.440495+00	2025-10-26 16:51:36.833+00	\N
8d5ba3da-db2f-4176-b581-bed88d6a2746	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 16:52:10.594742+00	2025-10-26 16:52:09.995+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
97826971-3afe-44ee-855c-372de7e106a1	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 16:52:10.822322+00	2025-10-26 16:52:10.272+00	{"expires_at": "2025-10-26T16:57:10.139+00:00"}
a2e63eb2-b14e-4733-b303-44e4ca91d4ce	kmiko28@gmail.com	settings.update.draft	\N	2025-10-26 16:52:26.457969+00	2025-10-26 16:52:25.891+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]}}, "changedKeys": ["about_team"]}
7d8a3dfa-8000-4520-a0db-c1970281c64d	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-10-26 16:52:28.756037+00	2025-10-26 16:52:28.193+00	{"changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]}}, "changedKeys": ["about_team"], "published_at": "2025-10-26T16:52:28.118Z"}
48770e88-689a-46de-8baf-0382d019f982	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 16:52:29.105519+00	2025-10-26 16:52:28.537+00	\N
29af7d43-eabc-4bc2-a2c7-c1d1df94dbb4	kmiko28@gmail.com	login	\N	2025-10-26 17:00:56.660887+00	2025-10-26 17:00:56.016+00	\N
7ba84f64-4e4c-4ee4-8d17-c47eb6c67bd0	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 17:01:02.140289+00	2025-10-26 17:01:01.568+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
208df003-1c22-495d-baec-af9a38cbb77b	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:01:02.557777+00	2025-10-26 17:01:01.966+00	{"expires_at": "2025-10-26T17:06:01.795+00:00"}
01425e71-26db-4c0f-bbd5-a712ede97969	kmiko28@gmail.com	logout	\N	2025-10-26 17:01:31.898706+00	2025-10-26 17:01:31.242+00	\N
2c1b0af5-71ea-4d5b-b47a-d1c34d48248b	unknown	logout	\N	2025-10-26 17:03:31.352549+00	2025-10-26 17:03:30.504+00	\N
802da8ad-b262-4a3e-843d-24eef6a028dc	kmiko28@gmail.com	login	\N	2025-10-26 17:29:00.674888+00	2025-10-26 17:28:59.702+00	\N
b4be134e-15a9-4a44-b904-fb50c8a733ad	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 17:29:07.335191+00	2025-10-26 17:29:06.678+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
6c8f0835-3cbc-4b39-8904-7feb05c1a858	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 17:34:08.052134+00	2025-10-26 17:34:07.367+00	{"expires_at": "2025-10-26T17:39:07.16+00:00"}
0a9e6502-3c4f-4521-b063-b6953a066f04	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 17:35:03.427258+00	2025-10-26 17:35:02.749+00	\N
e8d96067-cb7d-4fc9-b6e5-6e4326c59e95	kmiko28@gmail.com	logout	\N	2025-10-26 17:35:22.937732+00	2025-10-26 17:35:22.268+00	\N
9d92ef2f-a778-4e7e-8b91-26e49c8a0a25	kmiko28@gmail.com	login	\N	2025-10-26 17:40:09.999415+00	2025-10-26 17:40:09.255+00	\N
6f61bae3-2d9c-437d-aee4-c2f57105305f	kmiko28@gmail.com	logout	\N	2025-10-26 17:40:41.613061+00	2025-10-26 17:40:40.902+00	\N
90a5f953-616b-4ed6-9ace-b4e724a5f921	kmiko28@gmail.com	login	\N	2025-10-26 17:41:49.345279+00	2025-10-26 17:41:48.449+00	\N
6bb52ab1-d1d8-480c-9030-44052c4a57dd	kmiko28@gmail.com	logout	\N	2025-10-26 18:01:08.528709+00	2025-10-26 18:01:07.5+00	\N
2275220f-a3ee-4606-baf1-8cbc45e77b6e	kmiko28@gmail.com	login	\N	2025-10-26 18:29:34.726379+00	2025-10-26 18:29:33.81+00	\N
c8722a19-2003-44e0-ba7e-0f7adbebb0c9	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-26 18:29:39.664757+00	2025-10-26 18:29:38.831+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
652947b4-e992-45cc-bc85-7915a59c47bc	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-26 18:29:40.011586+00	2025-10-26 18:29:39.188+00	{"expires_at": "2025-10-26T18:34:38.947+00:00"}
e3293f39-a307-4e8e-9dc4-453e1c0b0e20	kmiko28@gmail.com	settings.lock.release	\N	2025-10-26 18:30:03.358346+00	2025-10-26 18:30:02.481+00	\N
b46b5c17-5bde-4e61-bb85-53c0a5ca8c44	kmiko28@gmail.com	logout	\N	2025-10-26 18:35:56.416382+00	2025-10-26 18:35:55.267+00	\N
822391a8-102a-4ce9-aca6-d367522ad632	unknown	logout	\N	2025-10-26 18:39:41.426098+00	2025-10-26 18:39:40.466+00	\N
2767c921-335d-4ac7-ac6d-85a774032810	kmiko28@gmail.com	login	\N	2025-10-26 22:02:32.314033+00	2025-10-26 22:02:30.734+00	\N
0e4b9453-c0c9-43c0-b6ab-5fb3068fb7f9	kmiko28@gmail.com	logout	\N	2025-10-26 22:02:47.653252+00	2025-10-26 22:02:46.217+00	\N
018d4e5b-d70e-47da-8f89-252be7617657	kmiko28@gmail.com	login	\N	2025-10-26 22:45:29.736725+00	2025-10-26 22:45:27.917+00	\N
73b71a0b-4b34-4c81-af22-911da76741c6	kmiko28@gmail.com	logout	\N	2025-10-26 22:52:00.689526+00	2025-10-26 22:51:59.122+00	\N
12fba92c-838b-4459-9979-ac420a71485f	kmiko28@gmail.com	login	\N	2025-10-27 03:40:43.609921+00	2025-10-27 03:40:40.728+00	\N
a6140408-3f49-4a5d-81c6-f24af3c250db	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-27 03:41:16.685363+00	2025-10-27 03:41:14.413+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
0c6fbbf7-9f56-41fe-9372-54de3093ecd8	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-27 03:41:16.951837+00	2025-10-27 03:41:14.678+00	{"expires_at": "2025-10-27T03:46:14.517+00:00"}
7e23cff8-71c7-4460-8fd0-93a6d0d15545	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-27 03:41:24.136226+00	2025-10-27 03:41:21.861+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
3d73474d-723b-45ed-a7b0-b30d1d89153c	kmiko28@gmail.com	logout	\N	2025-10-27 03:41:33.168411+00	2025-10-27 03:41:30.834+00	\N
7a56360d-b4c1-42b2-92f3-2e1919d44bea	kmiko28@gmail.com	login	\N	2025-10-30 00:29:16.754679+00	2025-10-30 00:29:14.667+00	\N
e30bee05-c240-49a8-b2fb-44f6fd835e41	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-30 00:29:27.737604+00	2025-10-30 00:29:26.28+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
5998fcee-4553-45ca-b415-2d47d4f4e6c6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 00:29:28.164768+00	2025-10-30 00:29:26.737+00	{"expires_at": "2025-10-30T00:34:26.472+00:00"}
7d805002-9dea-444e-abb7-340bf179cfb2	kmiko28@gmail.com	contact_response_update	\N	2025-10-30 00:30:24.043426+00	2025-10-30 00:30:22.57+00	{"id": "22ff0f93-e0a1-483f-9179-06785b4a2541", "hasNotes": false, "responded": true}
e4347e39-7f24-4fa1-b188-c37b493be46f	kmiko28@gmail.com	contact_response_update	\N	2025-10-30 00:30:27.503024+00	2025-10-30 00:30:26.033+00	{"id": "22ff0f93-e0a1-483f-9179-06785b4a2541", "hasNotes": false, "responded": false}
0924e8cb-a377-41ce-9eaa-74fe047f9ccc	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 00:30:28.582537+00	2025-10-30 00:30:27.121+00	{"expires_at": "2025-10-30T00:35:26.883+00:00"}
280a66f4-7bf3-4cee-8cb3-38fb542cfd63	kmiko28@gmail.com	contact_response_update	\N	2025-10-30 00:30:39.803732+00	2025-10-30 00:30:38.378+00	{"id": "22ff0f93-e0a1-483f-9179-06785b4a2541", "hasNotes": false, "responded": true}
acf71e7b-6884-4ce1-b06b-27baebc98844	kmiko28@gmail.com	logout	\N	2025-10-30 00:31:00.47971+00	2025-10-30 00:30:59.059+00	\N
db1dd2f0-64a0-43f7-9f43-b2455ddaf22b	kmiko28@gmail.com	login	\N	2025-10-30 23:48:07.573688+00	2025-10-30 23:48:05.635+00	\N
81eca1c6-226b-40e3-b8d1-d4a59e99eea7	kmiko28@gmail.com	contact_response_update	\N	2025-10-31 00:00:53.013192+00	2025-10-31 00:00:51.617+00	{"id": "22ff0f93-e0a1-483f-9179-06785b4a2541", "hasNotes": false, "responded": false}
35e6fc50-c161-4d11-9fa9-df09c2a1fef3	kmiko28@gmail.com	contact_response_update	\N	2025-10-31 00:01:25.834442+00	2025-10-31 00:01:24.359+00	{"id": "22ff0f93-e0a1-483f-9179-06785b4a2541", "hasNotes": false, "responded": true}
69c9a6db-4ace-4a80-a25f-b84c5462c28a	kmiko28@gmail.com	login	\N	2025-11-28 21:57:35.660609+00	2025-11-28 21:57:34.571+00	\N
033108cc-a5ff-4fb7-86a9-24b2d80a5b46	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-30 23:48:42.618379+00	2025-10-30 23:48:41.269+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
6bb4d83a-805b-4deb-bc6a-f292031f1599	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:48:43.268923+00	2025-10-30 23:48:41.921+00	{"expires_at": "2025-10-30T23:53:41.567+00:00"}
265f979d-2b18-4e3a-bc25-b58707e6cbc3	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:49:43.709176+00	2025-10-30 23:49:42.374+00	{"expires_at": "2025-10-30T23:54:42.127+00:00"}
846f961d-a3d9-409a-9bd3-be06f7d043fa	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:50:43.732557+00	2025-10-30 23:50:42.389+00	{"expires_at": "2025-10-30T23:55:42.13+00:00"}
6a7d7138-1acc-4cad-8f16-06ff90de2ab8	kmiko28@gmail.com	settings.update.draft	\N	2025-10-30 23:51:26.361335+00	2025-10-30 23:51:25.034+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNYmmmmmm", "before": "Comedy That's TOO FUNNY"}}, "changedKeys": ["hero_title"]}
e4233fec-7621-46f5-8ad2-528151e1fdf9	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:51:43.686266+00	2025-10-30 23:51:42.349+00	{"expires_at": "2025-10-30T23:56:42.171+00:00"}
9b5d12e7-3f70-4b85-b8f8-1a29d87b1e42	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:52:43.787418+00	2025-10-30 23:52:42.417+00	{"expires_at": "2025-10-30T23:57:42.142+00:00"}
79a581f7-27a1-4032-baaa-26de073654f4	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-30 23:53:02.541901+00	2025-10-30 23:53:01.187+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
f944b06c-f2e9-44f8-819b-3559ce768b9e	kmiko28@gmail.com	settings.update.draft	\N	2025-10-30 23:53:09.737331+00	2025-10-30 23:53:08.412+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNYnnn", "before": "Comedy That's TOO FUNNY"}}, "changedKeys": ["hero_title"]}
147c6fc8-5556-467f-8b2d-851c8d72d4a9	kmiko28@gmail.com	settings.version.create	\N	2025-10-30 23:53:32.084748+00	2025-10-30 23:53:30.751+00	{"label": null, "stage": "draft", "snapshotKeys": ["site_title", "site_description", "site_keywords", "logo_url", "favicon_url", "footer_text", "hero_title", "hero_subtext", "hero_image_url", "featured_video_url", "contactemail", "contactphone", "maintenance_enabled", "maintenance_message", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "contact_socials", "theme_accent", "theme_bg", "footer_links", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
acfc764c-6dce-4f28-9d17-8605acc9b638	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:53:43.778726+00	2025-10-30 23:53:42.432+00	{"expires_at": "2025-10-30T23:58:42.102+00:00"}
3ecfe10f-9903-4fd6-994a-47e3242298bf	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-30 23:53:56.817488+00	2025-10-30 23:53:55.481+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
24edb0ef-474a-4ca4-ac0d-d2c3300f940d	kmiko28@gmail.com	settings.update.draft	\N	2025-10-30 23:54:03.167585+00	2025-10-30 23:54:01.825+00	{"stage": "draft", "changed": {"hero_title": {"after": "Comedy That's TOO FUNNY", "before": "Comedy That's TOO FUNNYd"}}, "changedKeys": ["hero_title"]}
526ddb67-e4df-4248-9092-23df7b01e0fe	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:54:43.699916+00	2025-10-30 23:54:42.34+00	{"expires_at": "2025-10-30T23:59:42.135+00:00"}
1e21f542-3166-4594-9347-e3f6af7e7d20	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-30 23:55:44.020342+00	2025-10-30 23:55:42.618+00	{"expires_at": "2025-10-31T00:00:42.116+00:00"}
951b1241-c16d-4bad-8eb7-d8162cf66d0c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-30 23:55:55.189588+00	2025-10-30 23:55:53.844+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
01c972ab-e5e9-4aa7-bc99-6c682d5f1192	kmiko28@gmail.com	settings.version.delete	\N	2025-10-30 23:56:10.68132+00	2025-10-30 23:56:09.278+00	{"label": null, "stage": "draft", "versionId": "cdd19bca-887f-4b02-ac81-e51bacd6f11e"}
992d095f-ef4e-46b9-b51b-72d876b0b9f3	kmiko28@gmail.com	logout	\N	2025-10-30 23:56:59.094317+00	2025-10-30 23:56:57.642+00	\N
c267c5a1-7c1e-4007-aa64-960ceb34b4f9	kmiko28@gmail.com	login	\N	2025-10-30 23:57:07.990575+00	2025-10-30 23:57:06.579+00	\N
a8a3764c-9253-4ef3-b017-8195aab47d69	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:32:10.521297+00	2025-11-28 20:32:09.793+00	\N
e2670a24-f80b-4859-a374-7831dffd7589	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-10-31 00:08:04.454296+00	2025-10-31 00:08:03.034+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
34c4331e-aa25-4bef-9449-8334124f38a6	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-31 00:08:04.946612+00	2025-10-31 00:08:03.571+00	{"expires_at": "2025-10-31T00:13:03.333+00:00"}
c46dffbd-9512-46c0-af35-dadecd8bae35	kmiko28@gmail.com	settings.lock.acquire	\N	2025-10-31 00:09:05.383883+00	2025-10-31 00:09:04.004+00	{"expires_at": "2025-10-31T00:14:03.725+00:00"}
469e4091-f27c-4421-958c-e611f9f604fd	mthagen26@gmail.com	login	\N	2025-10-31 00:09:11.36631+00	2025-10-31 00:09:09.937+00	\N
f06286a3-2485-4260-ae65-653416f82850	mthagen26@gmail.com	settings.pull_live_to_draft	\N	2025-10-31 00:09:20.584707+00	2025-10-31 00:09:19.213+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
968979a0-f0e9-4fd0-b080-a356e51f7b07	kmiko28@gmail.com	settings.lock.release	\N	2025-10-31 00:09:33.589935+00	2025-10-31 00:09:32.23+00	\N
e116c488-0391-4621-a80b-de07e6a10257	mthagen26@gmail.com	settings.lock.acquire	\N	2025-10-31 00:09:36.421455+00	2025-10-31 00:09:35.055+00	{"expires_at": "2025-10-31T00:14:34.882+00:00"}
a5e0f640-fe44-4fc7-ac42-86649e3cf334	mthagen26@gmail.com	settings.lock.release	\N	2025-10-31 00:09:49.664694+00	2025-10-31 00:09:48.288+00	\N
027ba07a-7fa1-4941-b472-b856476d2421	mthagen26@gmail.com	settings.lock.acquire	\N	2025-10-31 00:10:34.949959+00	2025-10-31 00:10:33.555+00	{"expires_at": "2025-10-31T00:15:33.37+00:00"}
93104d99-7c8f-4b4f-8eec-37b66d87116c	lucius@luciusmcqueen.com	login	\N	2025-10-31 00:11:18.519914+00	2025-10-31 00:11:17.063+00	\N
2e1f1db3-bffa-4fb2-bac4-b9c87930dc29	mthagen26@gmail.com	settings.lock.acquire	\N	2025-10-31 00:11:35.853384+00	2025-10-31 00:11:34.401+00	{"expires_at": "2025-10-31T00:16:33.755+00:00"}
0efcaf8c-e816-4567-937d-d71c242f83e3	mthagen26@gmail.com	allowlist_update	\N	2025-10-31 00:12:25.280804+00	2025-10-31 00:12:23.686+00	{"count": 2}
40fc2736-804d-443e-a468-56f7617e1755	mthagen26@gmail.com	login_denied	\N	2025-10-31 00:12:37.514659+00	2025-10-31 00:12:36.093+00	\N
1c6d3fb3-f84a-40d6-b3dc-c3ac15d842b8	mthagen26@gmail.com	login_denied	\N	2025-10-31 00:12:44.60001+00	2025-10-31 00:12:43.146+00	\N
20b36e5e-6be2-46a7-8e77-9ffea245069c	kmiko28@gmail.com	allowlist_update	\N	2025-10-31 00:13:13.034903+00	2025-10-31 00:13:11.608+00	{"count": 3}
70da265f-570a-4a16-80c5-e53808b4a7a6	mthagen26@gmail.com	login	\N	2025-10-31 00:13:17.494708+00	2025-10-31 00:13:16.068+00	\N
0ccb10f3-ee70-4b28-998f-b5f796c02433	lucius@luciusmcqueen.com	logout	\N	2025-10-31 00:14:08.072447+00	2025-10-31 00:14:06.65+00	\N
5ce7bf51-b798-4473-94a6-f583a2812907	mthagen26@gmail.com	logout	\N	2025-10-31 00:14:10.060059+00	2025-10-31 00:14:08.635+00	\N
17d0488d-8a9e-4d86-8424-5f06ea13b6af	kmiko28@gmail.com	logout	\N	2025-10-31 00:15:05.256718+00	2025-10-31 00:15:03.782+00	\N
58ed3c91-b856-4f9e-9891-d8c9cb097d63	kmiko28@gmail.com	login	\N	2025-11-01 23:42:29.432217+00	2025-11-01 23:42:27.91+00	\N
1436e5c7-945a-4e76-94dd-b08b925a6d51	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-01 23:43:10.384464+00	2025-11-01 23:43:09.085+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size"]}
76a6595a-388f-4ca6-b2f3-13bd26aece44	kmiko28@gmail.com	settings.lock.acquire	\N	2025-11-01 23:43:10.869365+00	2025-11-01 23:43:09.582+00	{"expires_at": "2025-11-01T23:48:09.371+00:00"}
06fd9410-b47a-4e69-b1cd-0fb8ba763b50	kmiko28@gmail.com	logout	\N	2025-11-01 23:43:27.274211+00	2025-11-01 23:43:25.942+00	\N
cc358e33-172e-4d6f-a22a-455f325fffa9	kmiko28@gmail.com	login	\N	2025-11-02 00:15:01.639289+00	2025-11-02 00:14:59.86+00	\N
855340c2-099d-4d05-a042-2d0fe835ffe1	kmiko28@gmail.com	allowlist_update	\N	2025-11-02 00:15:12.417039+00	2025-11-02 00:15:10.941+00	{"count": 3, "messagingOptIn": 4}
48dd39f9-766c-4f0b-b761-f3a9aa4f82ee	kmiko28@gmail.com	logout	\N	2025-11-02 00:15:55.483152+00	2025-11-02 00:15:54.078+00	\N
378fcd68-a9ea-464c-a124-700704a5a5ac	kmiko28@gmail.com	login	\N	2025-11-02 00:20:06.407809+00	2025-11-02 00:20:04.908+00	\N
d9c0bd99-d0c8-47d2-82e6-ee0f8afdde44	kmiko28@gmail.com	logout	\N	2025-11-02 00:27:57.888357+00	2025-11-02 00:27:56.399+00	\N
51e253ea-18aa-4fcb-aa40-4438f13863c0	kmiko28@gmail.com	login	\N	2025-11-02 00:30:05.747553+00	2025-11-02 00:30:04.233+00	\N
99beff8a-327d-49c2-a3c6-83454a25f5de	kmiko28@gmail.com	login	\N	2025-11-02 00:31:56.711531+00	2025-11-02 00:31:55.116+00	\N
a28fccc2-1947-4f9e-a28e-0ddb974c8869	kmiko28@gmail.com	logout	\N	2025-11-02 00:38:46.501111+00	2025-11-02 00:38:44.763+00	\N
a5907251-d351-469e-89af-7f9932afd9ca	kmiko28@gmail.com	login	\N	2025-11-02 02:14:49.472332+00	2025-11-02 02:14:47.658+00	\N
b715f742-fb70-4d78-883d-a45bf929c1ee	kmiko28@gmail.com	messaging	\N	2025-11-02 02:15:17.130181+00	2025-11-02 02:15:15.361+00	{"event": "conversation.created", "subject": "Test", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
2cdfebfc-dd88-401e-9f1a-5bcb47ee83bc	kmiko28@gmail.com	messaging	\N	2025-11-02 02:15:17.269808+00	2025-11-02 02:15:15.582+00	{"event": "message.sent", "messageId": "5ef6c166-11c3-46d4-948a-ee0963f402c4", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
e7f9cd26-5b1c-4300-9ac9-2e5f852f8f5c	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-02 02:16:10.127642+00	2025-11-02 02:16:08.419+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
074e7477-81c1-4345-83e5-94dc94141ed7	kmiko28@gmail.com	settings.update.draft	\N	2025-11-02 02:16:47.982069+00	2025-11-02 02:16:46.292+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}, {"url": "https://drive.google.com/drive/folders/1qKxO7Uud8rb_99m-Kxl0IljgO-F9GNT-", "label": "Too Funny Backup from Too T3rpd"}], "before": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]}}, "changedKeys": ["admin_quick_links"]}
814c0b39-4924-404d-8702-4c6df49ad77d	kmiko28@gmail.com	login	\N	2025-11-02 03:33:47.121575+00	2025-11-02 03:33:45.171+00	\N
8a54aaeb-7ec4-49f2-ab27-72ae833cbe70	kmiko28@gmail.com	logout	\N	2025-11-02 03:35:18.841462+00	2025-11-02 03:35:16.883+00	\N
f6613eac-bee1-4d3e-b511-7b6de05482ea	kmiko28@gmail.com	login	\N	2025-11-02 03:35:22.321996+00	2025-11-02 03:35:20.407+00	\N
4d7082a1-053c-4a47-b893-4bddfae53ad9	kmiko28@gmail.com	logout	\N	2025-11-02 03:35:23.808945+00	2025-11-02 03:35:21.897+00	\N
112ac020-e412-49a8-802f-2e29548582f3	kmiko28@gmail.com	login	\N	2025-11-02 04:59:16.973481+00	2025-11-02 04:59:14.8+00	\N
3240ebf5-9426-4c29-acd4-ec3838a43f3f	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-02 04:59:25.810317+00	2025-11-02 04:59:23.657+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
704e4e43-ec78-4998-b028-e15fa99146ed	kmiko28@gmail.com	allowlist_update	\N	2025-11-02 05:00:00.724383+00	2025-11-02 04:59:58.524+00	{"count": 3, "messagingOptIn": 4}
6a5b7d66-0fbe-4c28-8a76-5667a4a70415	kmiko28@gmail.com	settings.update.draft	\N	2025-11-02 05:00:06.245251+00	2025-11-02 05:00:04.113+00	{"stage": "draft", "changed": {"admin_quick_links": {"after": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}, {"url": "https://drive.google.com/drive/folders/1qKxO7Uud8rb_99m-Kxl0IljgO-F9GNT-", "label": "Too Funny folder from Too T3rpd drive"}], "before": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]}}, "changedKeys": ["admin_quick_links"]}
7101e954-2819-4d91-b054-5e45d2b3dbcd	kmiko28@gmail.com	login	\N	2025-11-02 05:00:16.794871+00	2025-11-02 05:00:14.587+00	\N
2978081a-baf6-406b-b796-c2d24177e9b7	kmiko28@gmail.com	login	\N	2025-11-02 05:12:38.661406+00	2025-11-02 05:12:36.44+00	\N
5ad16219-59bd-4bf6-98aa-dd3d17acdc19	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-02 05:13:12.73663+00	2025-11-02 05:13:10.56+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
be9dc897-a9cb-4d12-b925-6d78bba16f83	kmiko28@gmail.com	settings.version.create	\N	2025-11-02 05:13:24.741401+00	2025-11-02 05:13:22.564+00	{"kind": "draft", "label": "test", "stage": "draft", "snapshotKeys": ["site_title", "site_description", "site_keywords", "logo_url", "favicon_url", "footer_text", "hero_title", "hero_subtext", "hero_image_url", "featured_video_url", "contactemail", "contactphone", "maintenance_enabled", "maintenance_message", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "contact_socials", "theme_accent", "theme_bg", "footer_links", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
2d4db956-7899-4fd0-b335-07b8e2433471	kmiko28@gmail.com	settings.version.restore	\N	2025-11-02 05:13:35.713007+00	2025-11-02 05:13:33.539+00	{"label": "test", "stage": "draft", "versionId": "cfd4b591-5624-4b26-bd40-20b30f691d79"}
1c7afbdf-0ccf-4e00-a8a2-5cbdc45b4c94	kmiko28@gmail.com	login	\N	2025-11-03 02:13:27.885356+00	2025-11-03 02:13:26.116+00	\N
fc215baf-777b-4d5d-a495-50fab5e7192e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 02:13:30.230493+00	2025-11-03 02:13:28.565+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
349fb3ef-5e97-4582-b5cc-7d6b223ce62e	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:42:43.186823+00	2025-11-28 20:42:42.344+00	\N
35a8f95b-95ab-4d45-a061-6c43712066a5	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:42:47.317447+00	2025-11-28 20:42:46.557+00	\N
3e9b6d3c-ce68-45e4-8c9d-935c6adc64ea	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:42:52.104743+00	2025-11-28 20:42:51.205+00	\N
2757aa7a-1a9f-4e5c-a4f0-6aa552d63cde	kmiko28@gmail.com	logout	\N	2025-11-28 22:03:44.489804+00	2025-11-28 22:03:43.492+00	\N
0f05062c-3c48-41a0-ae7a-08e96f397816	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 02:20:11.463653+00	2025-11-03 02:20:09.772+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
839ea1ec-1e67-44e7-8217-8545d553569e	unknown	logout	\N	2025-11-03 02:26:51.888617+00	2025-11-03 02:26:49.799+00	\N
e12eaa24-c8b9-4c69-b543-ce782231cf68	kmiko28@gmail.com	login	\N	2025-11-03 02:37:59.605726+00	2025-11-03 02:37:57.607+00	\N
117b1617-7bd5-426d-8d7d-e196da659b4e	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 02:38:02.174298+00	2025-11-03 02:38:00.44+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
dc028a4d-c7ab-4158-881e-66f7652b5aed	kmiko28@gmail.com	logout	\N	2025-11-03 02:44:01.140472+00	2025-11-03 02:43:59.295+00	\N
79f2eee0-5b3d-451d-86fb-9f827f1637c0	kmiko28@gmail.com	login	\N	2025-11-03 02:55:52.855186+00	2025-11-03 02:55:51.013+00	\N
971f3f69-3638-4535-af03-feaed92324b3	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 02:55:55.70427+00	2025-11-03 02:55:53.932+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
945f730f-1e3e-423e-81ff-7ac145249eec	kmiko28@gmail.com	logout	\N	2025-11-03 03:02:15.018455+00	2025-11-03 03:02:13.077+00	\N
90240df0-9e37-48a4-b8ce-0ae8a28d90ac	kmiko28@gmail.com	login	\N	2025-11-03 03:41:52.796388+00	2025-11-03 03:41:50.792+00	\N
fcc7995c-cd5f-43d2-8044-319d233a8967	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 03:41:55.898151+00	2025-11-03 03:41:53.99+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
ce7e891c-ac40-4e25-ad27-c8350bcede2d	kmiko28@gmail.com	logout	\N	2025-11-03 03:42:10.683907+00	2025-11-03 03:42:08.772+00	\N
5f6ab454-6656-4930-a379-41d1959aa5aa	toofunnysketch@gmail.com	login	\N	2025-11-03 10:11:14.633807+00	2025-11-03 10:11:11.167+00	\N
8ce48843-b206-4848-8ec2-61549e7aef06	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 10:12:18.219372+00	2025-11-03 10:12:15.276+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
023fe876-b02f-4896-9702-0a68a0f52089	toofunnysketch@gmail.com	settings.update.draft	\N	2025-11-03 10:13:58.555707+00	2025-11-03 10:13:55.636+00	{"stage": "draft", "changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]}}, "changedKeys": ["about_team"]}
086d75af-7439-42de-8623-6b2bbb8afda6	toofunnysketch@gmail.com	settings.publish_draft_to_live	\N	2025-11-03 10:16:08.293572+00	2025-11-03 10:16:05.349+00	{"changed": {"about_team": {"after": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "before": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]}}, "changedKeys": ["about_team"], "published_at": "2025-11-03T10:16:04.977Z"}
763cbfb3-381a-498f-9d2e-af7c5a81ff23	toofunnysketch@gmail.com	messaging	\N	2025-11-03 10:20:57.640625+00	2025-11-03 10:20:54.655+00	{"event": "message.sent", "messageId": "87411d45-c8ec-4435-b2f4-93c9e8727641", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
799a5451-c75d-49cb-a35b-a92e05d13ab0	toofunnysketch@gmail.com	logout	\N	2025-11-03 10:26:01.353526+00	2025-11-03 10:25:58.282+00	\N
5f9efac2-aed0-4036-a007-36c9a2c77918	unknown	logout	\N	2025-11-03 10:26:08.018216+00	2025-11-03 10:26:05.013+00	\N
bd595f01-cebc-4611-b7b9-d3e8ac6c2755	toofunnysketch@gmail.com	login	\N	2025-11-03 11:19:12.208758+00	2025-11-03 11:19:08.5+00	\N
4a212368-de58-43a6-82c3-b440f73b54af	toofunnysketch@gmail.com	messaging	\N	2025-11-03 11:20:12.383549+00	2025-11-03 11:20:09.213+00	{"event": "message.sent", "messageId": "3c03ab8a-e80f-4ef7-83c4-ae8e9104b4c4", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
bc2bd708-87a4-45ec-b35f-add3431f5684	toofunnysketch@gmail.com	logout	\N	2025-11-03 11:24:16.030764+00	2025-11-03 11:24:12.716+00	\N
5d577ec4-e166-4948-a97b-4f7f4a820c5a	toofunnysketch@gmail.com	login	\N	2025-11-03 16:25:26.157084+00	2025-11-03 16:25:25.554+00	\N
f0dd6f85-70fe-4831-bb0a-45b8c11f1e36	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:46:40.718063+00	2025-11-28 20:46:39.653+00	\N
02e9fe3c-2855-4dcc-a8c0-e48a74bf79cd	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:46:44.529254+00	2025-11-28 20:46:43.777+00	\N
763c4b68-1536-40ed-873e-b9bcba3aa703	kmiko28@gmail.com	login	\N	2025-11-29 05:46:35.194608+00	2025-11-29 05:46:32.298+00	\N
e395283e-1306-44e2-9165-2c2e65818ba0	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:25:33.432013+00	2025-11-03 16:25:33.295+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
733f4cfc-d7ff-4336-a5fc-7a15ae7a4a83	toofunnysketch@gmail.com	settings.update.draft	\N	2025-11-03 16:31:30.367927+00	2025-11-03 16:31:30.224+00	{"stage": "draft", "changed": {"about_body": {"after": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "before": null}}, "changedKeys": ["about_body"]}
933d1409-69b5-4ff8-aed2-30c8d15c4f27	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:32:22.219252+00	2025-11-03 16:32:22.041+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
abeb31e7-7c91-4255-be24-933298e7a837	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:32:24.522758+00	2025-11-03 16:32:24.334+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
f66022a4-943d-452e-abc5-04ffa183e97d	toofunnysketch@gmail.com	settings.publish_draft_to_live	\N	2025-11-03 16:33:30.461296+00	2025-11-03 16:33:30.294+00	{"changed": {}, "changedKeys": [], "published_at": "2025-11-03T16:33:29.699Z"}
79cb55de-d200-4e63-8058-0d721c9cdd07	toofunnysketch@gmail.com	settings.snapshot.set_default	\N	2025-11-03 16:33:30.898899+00	2025-11-03 16:33:30.745+00	{"kind": "published", "label": "About us change", "snapshotId": "8b2502e4-0375-4df8-8bf0-004144d45a6d"}
ef175b93-9445-4afb-8cb4-161b0e0a6e4b	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:34:29.87982+00	2025-11-03 16:34:29.718+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
0a0323c4-3d0d-4ea5-b773-49a141f8500d	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:34:33.495108+00	2025-11-03 16:34:33.339+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
9da57821-be11-45c2-82b2-70c323ce7d9d	toofunnysketch@gmail.com	logout	\N	2025-11-03 16:34:53.415003+00	2025-11-03 16:34:53.084+00	\N
6ec515d5-4f44-4291-87d3-9f800ed7fa2a	toofunnysketch@gmail.com	login	\N	2025-11-03 16:35:29.430622+00	2025-11-03 16:35:29.017+00	\N
84ac18ce-6273-4a70-9e10-e3b45cf196fc	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:53:32.598424+00	2025-11-28 20:53:31.256+00	\N
39fcd3be-dc14-4fea-b165-de406f331c7c	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:53:40.413545+00	2025-11-28 20:53:39.626+00	\N
1ff1502b-b3dd-4315-a31e-444f650999b1	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:53:44.834651+00	2025-11-28 20:53:44.028+00	\N
bd9dc757-5536-4c9c-acd3-2e91b9c54161	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:53:54.763863+00	2025-11-28 20:53:54.015+00	\N
f59f1253-ad05-4092-93fa-5782445e18eb	toofunnysketch@gmail.com	settings.pull_live_to_draft	\N	2025-11-03 16:36:15.696476+00	2025-11-03 16:36:15.513+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
7b1e4c0b-cc6d-49c7-a2b4-3946b4732f45	toofunnysketch@gmail.com	settings.update.draft	\N	2025-11-03 16:36:37.704154+00	2025-11-03 16:36:37.532+00	{"stage": "draft", "changed": {"about_body": {"after": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "before": null}}, "changedKeys": ["about_body"]}
0489caae-6757-435f-895d-c8fae537c01b	toofunnysketch@gmail.com	settings.publish_draft_to_live	\N	2025-11-03 16:37:38.533602+00	2025-11-03 16:37:38.366+00	{"changed": {"about_body": {"after": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "before": null}}, "changedKeys": ["about_body"], "published_at": "2025-11-03T16:37:37.814Z"}
149d9491-0588-4cd6-b39a-bc65df182cbf	toofunnysketch@gmail.com	logout	\N	2025-11-03 16:38:10.426848+00	2025-11-03 16:38:10.205+00	\N
53163ab2-68eb-45f0-8c5a-99c2475bbf5f	kmiko28@gmail.com	login	\N	2025-11-04 01:29:16.070229+00	2025-11-04 01:29:13.529+00	\N
a5f4493d-ed75-40e6-a14a-fa5a148c43e4	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-04 01:29:22.067124+00	2025-11-04 01:29:20.462+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
eaa97b82-db1a-4d01-8491-759778c16d95	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-11-04 01:30:01.94976+00	2025-11-04 01:30:00.367+00	{"changed": {}, "changedKeys": [], "published_at": "2025-11-04T01:29:59.998Z"}
5ee73aa2-104c-4763-be58-7a74a8271327	kmiko28@gmail.com	logout	\N	2025-11-04 01:40:09.93556+00	2025-11-04 01:40:08.048+00	\N
5be7895c-1f22-4888-8ee2-f3551c72ddbc	toofunnysketch@gmail.com	login	\N	2025-11-05 00:03:56.720726+00	2025-11-05 00:03:54.387+00	\N
bb92dfad-bb37-4084-882e-775e6bf5004b	toofunnysketch@gmail.com	logout	\N	2025-11-05 02:54:35.397207+00	2025-11-05 02:54:32.991+00	\N
e66cce48-664a-4257-93d7-1e5bcbef9759	kmiko28@gmail.com	login	\N	2025-11-09 16:19:38.658767+00	2025-11-09 16:19:38.291+00	\N
89f956e0-a294-4c2d-bbfa-e83078099b2c	kmiko28@gmail.com	messaging	\N	2025-11-09 16:20:20.928232+00	2025-11-09 16:20:20.576+00	{"event": "message.sent", "messageId": "d8b8f3ac-f30d-4e01-aa01-2a78e16e84a5", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
b6542055-18db-479d-9cb0-e8a74616a8ac	kmiko28@gmail.com	logout	\N	2025-11-09 17:21:05.804311+00	2025-11-09 17:21:04.96+00	\N
72bcd600-39d8-42e0-8cfe-b6768f8843b9	kmiko28@gmail.com	login	\N	2025-11-10 14:08:55.037686+00	2025-11-10 14:08:50.616+00	\N
fe28cf4f-240a-4ca4-9de5-4f0d6acac11a	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-10 14:08:59.104631+00	2025-11-10 14:08:55.39+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
38dd1ace-81a7-4c28-ba21-964fb3ff39b9	kmiko28@gmail.com	messaging	\N	2025-11-10 14:10:20.052274+00	2025-11-10 14:10:16.261+00	{"event": "message.sent", "messageId": "9c5b4ef6-d571-4568-b5f7-dc4d7bbfec56", "conversationId": "bbfd9f3f-2fe9-41d0-a125-57df773107cb"}
0d8c0b30-a3b6-4e82-8c92-57176872fb47	kmiko28@gmail.com	logout	\N	2025-11-10 14:10:27.043683+00	2025-11-10 14:10:23.087+00	\N
225d5ba3-4569-46f6-a813-2f74c3ad43ba	kmiko28@gmail.com	login	\N	2025-11-28 13:06:56.36901+00	2025-11-28 13:06:53.027+00	\N
fccfab76-c754-49ea-800e-71841ec5a140	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-28 13:06:59.100327+00	2025-11-28 13:06:55.846+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
4c9ad7aa-5eec-424e-a3e4-14fdc0afcaab	kmiko28@gmail.com	logout	\N	2025-11-28 13:14:27.657061+00	2025-11-28 13:14:24.296+00	\N
0c168f19-017e-4a96-ba0f-d00f98bbde68	kmiko28@gmail.com	login	\N	2025-11-28 17:24:51.558124+00	2025-11-28 17:24:50.4+00	\N
f536a130-c5af-49a7-a843-82636ddc3d96	kmiko28@gmail.com	logout	\N	2025-11-28 17:35:17.960826+00	2025-11-28 17:35:17.515+00	\N
b2275f8c-99f6-4d26-9e83-9556c5d73d70	kmiko28@gmail.com	login_denied	\N	2025-11-28 20:30:49.952977+00	2025-11-28 20:30:49.259+00	\N
65723f91-4c16-4071-8e77-b1b3089f0366	kmiko28@gmail.com	settings.pull_live_to_draft	\N	2025-11-29 05:48:39.198702+00	2025-11-29 05:48:37.038+00	{"copiedKeys": ["hero_title", "hero_subtext", "footer_text", "contactemail", "contactphone", "featured_video_url", "footer_links", "contact_socials", "logo_url", "favicon_url", "site_title", "site_description", "site_keywords", "maintenance_enabled", "maintenance_message", "theme_accent", "maintenance_schedule_enabled", "maintenance_daily_start", "maintenance_daily_end", "maintenance_timezone", "hero_image_url", "theme_bg", "header_bg", "footer_bg", "session_timeout_minutes", "who_title", "who_body", "who_cta_label", "who_cta_url", "about_title", "about_body", "about_mission_title", "about_mission_body", "about_team_intro", "about_team", "events_title", "events_intro", "events_upcoming", "events_past", "media_title", "media_intro", "media_sections", "merch_title", "merch_intro", "merch_items", "contact_title", "contact_intro", "contact_cards", "admin_quick_links", "who_image_url", "theme_use_global", "hero_title_size", "hero_subtext_size", "hero_badge_size", "hero_title_font_size", "hero_subtext_font_size", "hero_badge_font_size"]}
a7f230c4-52b8-4e94-a125-6ca242420b4b	kmiko28@gmail.com	media.upload	\N	2025-11-29 05:50:37.464297+00	2025-11-29 05:50:35.289+00	{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1764395434775_TFP.png", "path": "1764395434775_TFP.png", "size": 344540, "mimetype": "image/png", "originalName": "TFP.png"}
8d4ebf60-332f-4f27-9375-4643f37d5860	kmiko28@gmail.com	settings.update.draft	\N	2025-11-29 05:50:41.839272+00	2025-11-29 05:50:39.687+00	{"stage": "draft", "changed": {"logo_url": {"after": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1764395434775_TFP.png", "before": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO"}}, "changedKeys": ["logo_url"]}
1a268995-84cc-4a8d-86a3-7e34b48f968a	kmiko28@gmail.com	settings.publish_draft_to_live	\N	2025-11-29 05:50:58.35807+00	2025-11-29 05:50:56.18+00	{"changed": {}, "changedKeys": [], "published_at": "2025-11-29T05:50:55.141Z"}
3c7b45ed-1025-4f38-8136-2578288bee88	kmiko28@gmail.com	settings.snapshot.set_default	\N	2025-11-29 05:50:59.180799+00	2025-11-29 05:50:56.977+00	{"kind": "published", "label": "Manual publish", "snapshotId": "20b13d01-1938-4c16-abfe-e60efe6b2249"}
41c02a50-3414-470c-a502-af0d57e989c8	kmiko28@gmail.com	logout	\N	2025-11-29 06:23:02.150179+00	2025-11-29 06:22:59.709+00	\N
73c63800-403e-4b8a-8a0c-bb01aea64eb9	kmiko28@gmail.com	login	\N	2025-11-30 02:32:37.894209+00	2025-11-30 02:32:36.038+00	\N
\.


--
-- Data for Name: contact_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contact_messages (id, name, email, message, created_at) FROM stdin;
\.


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.events (id, title, location, date, description, ticket_url, image_url, created_at) FROM stdin;
c45d7be3-5ceb-4b7d-850d-b8119a1f9f33	Too Funny Live - St. Louis	City Museum Theater	2025-11-02	A night of sketch comedy and improv with the Too Funny crew.	\N	\N	2025-10-04 18:05:31.527959+00
0f07f249-c61e-471d-9fb9-1d7f72ab8645	Too Funny Holiday Special	The Blue Room Comedy Club, Springfield	2025-12-07	Join us for a holiday-themed show with laughter and surprises!	\N	\N	2025-10-04 18:05:31.527959+00
\.


--
-- Data for Name: media; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.media (id, title, video_url, thumbnail_url, description, created_at) FROM stdin;
7f3ea63a-80c6-4727-aa47-c9bc3be06058	Too Funny Intro Clip	https://www.youtube.com/watch?v=dQw4w9WgXcQ	\N	A quick look at our most chaotic sketches.	2025-10-04 18:05:31.527959+00
e7b918e5-e75d-45c3-84dd-0993b976cd9a	Behind the Scenes	https://www.youtube.com/watch?v=9bZkp7q19f0	\N	Behind the scenes of our 2025 shoot.	2025-10-04 18:05:31.527959+00
\.


--
-- Data for Name: merch; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.merch (id, name, price, image_url, description, stock, created_at) FROM stdin;
dff97dd7-ea68-4c74-888d-c91b4b9ce344	Too Funny T-Shirt	25.00	https://via.placeholder.com/300x300.png?text=T-Shirt	Our official Too Funny tee. Soft cotton and pure chaos.	50	2025-10-04 18:05:31.527959+00
fc11abb3-24e3-42da-b937-e34cc5974279	Too Funny Mug	15.00	https://via.placeholder.com/300x300.png?text=Mug	Perfect for your morning coffee or late-night comedy writing.	30	2025-10-04 18:05:31.527959+00
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings (id, hero_title, hero_subtext, footer_text, contactemail, contactphone, updated_at, hero_image, featured_video_url, accent_color, background_gradient, theme_home, theme_about, theme_events, theme_media, theme_merch, theme_contact, footer_links, contact_socials, inserted_at, created_at, logo_url, favicon_url, meta_title, meta_description, meta_keywords, site_title, site_description, site_keywords, maintenance_enabled, maintenance_message, theme_primary, theme_accent, maintenance_schedule_enabled, maintenance_daily_start, maintenance_daily_end, maintenance_timezone) FROM stdin;
251f0f97-5318-4802-97d4-1b27cd7e20ca	Comedy that’s Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© 2025 Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-13 03:19:37.89+00	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/uploads/1759712076071_TooFunnyThePrequel.png	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4	#FFD700	linear-gradient(to right, #000000, #1a1a40)	{}	{}	{}	{}	{}	{}	[]	[]	2025-10-05 19:18:51.833727+00	2025-10-05 19:18:51.833727	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	\N	\N	f	\N	\N	\N
\.


--
-- Data for Name: settings_deployments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings_deployments (id, snapshot_id, fallback_snapshot_id, start_at, end_at, status, created_at, updated_at, created_by, updated_by, cancelled_at, cancelled_by, override_reason, activated_at, completed_at) FROM stdin;
\.


--
-- Data for Name: settings_draft; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings_draft (id, site_title, site_description, site_keywords, logo_url, favicon_url, footer_text, hero_title, hero_subtext, hero_image_url, featured_video_url, contactemail, contactphone, accent_color, background_gradient, maintenance_enabled, maintenance_message, maintenance_schedule_enabled, maintenance_daily_start, maintenance_daily_end, maintenance_timezone, updated_at, contact_socials, theme_accent, theme_bg, footer_links, admin_timeout_minutes, published_at, created_at, header_bg, footer_bg, session_timeout_minutes, who_title, who_body, who_cta_label, who_cta_url, about_title, about_body, about_mission_title, about_mission_body, about_team_intro, about_team, events_title, events_intro, events_upcoming, events_past, media_title, media_intro, media_sections, merch_title, merch_intro, merch_items, contact_title, contact_intro, contact_cards, admin_quick_links, who_image_url, theme_use_global, hero_title_size, hero_subtext_size, hero_badge_size, hero_title_font_size, hero_subtext_font_size, hero_badge_font_size) FROM stdin;
9c630551-16a3-4ea8-ba8a-9b4432e821a7	Too Funny Productions	\N	\N	\N	\N	© Too Funny Productions. All rights reserved.	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	\N	\N	info@toofunnyproductions.com	555-555-5555	\N	\N	f	\N	\N	\N	\N	\N	2025-10-19 12:44:13.726492+00	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	2025-10-19 02:40:23.242028+00	#000000	#000000	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	medium	medium	medium	\N	\N	\N
f335f710-b8f8-449f-9c0d-2ecc0645e31e	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	f	\N	\N	\N	2025-10-19 13:28:19.797962+00	[]	#FFD700	linear-gradient(to right, #000, #1a1a40)	[]	30	\N	2025-10-19 13:28:19.797962+00	#000000	#000000	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	medium	medium	medium	\N	\N	\N
4943bfd5-dd53-43ec-9d44-97297df8c87e	\N	\N	\N	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	\N	Comedy That's TOO FUNNY	Original sketch, live shows, and shamelessly fun chaos.	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4	info@toofunnyproductions.com	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	2025-11-29 05:48:39.105064+00	{"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}	#FFD700	linear-gradient(to right, #000, #1a1a40)	[]	30	2025-11-04 01:29:59.998+00	2025-10-19 02:18:31.551747+00	#000000	#000000	5	\N	\N	\N	\N	\N	Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.	\N	\N	\N	[{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]	\N	\N	[]	[{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}]	\N	\N	[{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}]	\N	\N	[]	\N	\N	[]	[{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]	\N	t	large	medium	medium	\N	\N	\N
7dea2781-cbb0-41af-8d8c-cd57fd5bfc6f	\N	\N	\N	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1764395434775_TFP.png	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	\N	Comedy That's TOO FUNNY	Original sketch, live shows, and shamelessly fun chaos.	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4	info@toofunnyproductions.com	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	2025-11-29 05:50:41.778175+00	{"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}	#FFD700	linear-gradient(to right, #000, #1a1a40)	[]	30	2025-10-26 16:52:28.118+00	2025-10-19 02:18:31.551747+00	#000000	#000000	5	\N	\N	\N	\N	\N	\N	\N	\N	\N	[{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]	\N	\N	[]	[{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}]	\N	\N	[{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}]	\N	\N	[]	\N	\N	[]	[{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]	\N	t	large	medium	medium	\N	\N	\N
98cdde56-55da-45cc-b374-4a50ea117f12	\N	\N	\N	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	\N	Comedy That's TOO FUNNY	Original sketch, live shows, and shamelessly fun chaos.	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4	info@toofunnyproductions.com	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	2025-11-10 14:08:58.994387+00	{"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}	#FFD700	linear-gradient(to right, #000, #1a1a40)	[]	30	2025-11-04 01:29:59.998+00	2025-10-19 02:18:31.551747+00	#000000	#000000	5	\N	\N	\N	\N	\N	Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.	\N	\N	\N	[{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]	\N	\N	[]	[{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}]	\N	\N	[{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}]	\N	\N	[]	\N	\N	[]	[{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]	\N	t	large	medium	medium	\N	\N	\N
\.


--
-- Data for Name: settings_lock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings_lock (id, holder_email, acquired_at, expires_at, created_at, updated_at, active_version_id, source_version_id, auto_saved_version_id) FROM stdin;
1	kmiko28@gmail.com	2025-11-01 23:43:09.371+00	2025-11-01 23:48:09.371+00	2025-10-24 23:14:47.361635+00	2025-10-24 23:14:47.361635+00	\N	\N	\N
\.


--
-- Data for Name: settings_public; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings_public (id, hero_title, hero_subtext, footer_text, contactemail, contactphone, updated_at, hero_image, featured_video_url, accent_color, background_gradient, theme_home, theme_about, theme_events, theme_media, theme_merch, theme_contact, footer_links, contact_socials, inserted_at, created_at, logo_url, favicon_url, meta_title, meta_description, meta_keywords, site_title, site_description, site_keywords, maintenance_enabled, maintenance_message, theme_primary, theme_accent, maintenance_schedule_enabled, maintenance_daily_start, maintenance_daily_end, maintenance_timezone, hero_image_url, theme_bg, published_at, admin_timeout_minutes, header_bg, footer_bg, session_timeout_minutes, who_title, who_body, who_cta_label, who_cta_url, about_title, about_body, about_mission_title, about_mission_body, about_team_intro, about_team, events_title, events_intro, events_upcoming, events_past, media_title, media_intro, media_sections, merch_title, merch_intro, merch_items, contact_title, contact_intro, contact_cards, admin_quick_links, who_image_url, theme_use_global, hero_title_size, hero_subtext_size, hero_badge_size, hero_title_font_size, hero_subtext_font_size, hero_badge_font_size) FROM stdin;
a14ae28a-a55a-4602-8c75-c31e87a15aa6	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
821ea835-b18c-4da9-81f8-8409b4bc3c00	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
ac85d11b-213b-4c24-9548-29ab469a8c19	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
b575b3ef-2f52-42cb-ae10-f7e77c70f39f	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	#FFD700	linear-gradient(to right, #000, #1a1a40)	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
2e65e1b7-170f-42e7-b7f1-820736944abd	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
43cdd81e-8dc0-47bf-839c-58188faddf23	Comedy that's Too Funnyeeeeeeeeeee	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
ec03482e-b2a0-48fb-ba2a-fd0200093ef9	Comedy that's Too Funnyddddddddddddddd	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
9f347900-b8d0-4a6a-8ef0-01841a7f6e97	Comedy that's Too Funny	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
1f0fc9ad-c70d-48fb-8070-53a2321bc7ad	Comedy that's Too Funnyddf	Original sketch, live shows, and shamelessly fun chaos.	© Too Funny Productions. All rights reserved.	info@toofunnyproductions.com	555-555-5555	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Too Funny Productions	\N	\N	f	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
bc22dc89-5997-4cc8-8598-39939ae88129	\N	\N	\N	\N	\N	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
f30897af-df8d-415d-b57d-819a06478d74	\N	\N	\N	\N	\N	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
88509c12-4633-46a5-9158-397bbfebe8a9	\N	\N	\N	\N	\N	2025-10-19 13:28:19.797962+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	[]	\N	2025-10-19 13:28:19.797962	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	#FFD700	\N	\N	\N	\N	\N	linear-gradient(to right, #000, #1a1a40)	\N	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	[]	\N	\N	[]	[]	\N	\N	[]	\N	\N	[]	\N	\N	[]	[]	\N	t	\N	\N	\N	\N	\N	\N
151b40fc-3d78-493f-ac68-23b5f7212508	Comedy That's TOO FUNNY	Original sketch, live shows, and shamelessly fun chaos.	\N	info@toofunnyproductions.com	\N	2025-11-29 05:50:58.189473+00	\N	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4	\N	\N	\N	\N	\N	\N	\N	\N	[]	{"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}	\N	2025-10-19 02:40:23.242028	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	\N	\N	\N	\N	\N	\N	\N	\N	\N	#FFD700	\N	\N	\N	\N	https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png	linear-gradient(to right, #000, #1a1a40)	2025-11-29 05:50:55.141+00	30	#000000	#000000	5	\N	\N	\N	\N	\N	Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.	\N	\N	\N	[{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}]	\N	\N	[]	[{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}]	\N	\N	[{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}]	\N	\N	[]	\N	\N	[]	[{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}]	\N	t	large	medium	medium	\N	\N	\N
\.


--
-- Data for Name: settings_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings_versions (id, stage, data, label, author_email, created_at, status, note, kind, updated_at, published_at, is_default) FROM stdin;
cfd4b591-5624-4b26-bd40-20b30f691d79	draft	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": null, "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and his team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-02T05:13:22.400Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "published_at": "2025-10-26T16:52:28.118+00:00", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	test	kmiko28@gmail.com	2025-11-02 05:13:24.585265+00	active	\N	draft	2025-11-02 05:13:22.4+00	\N	f
a1a70d63-f669-4d37-90a3-eef971db0537	live	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": null, "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-03T10:16:05.429Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	Manual publish	toofunnysketch@gmail.com	2025-11-03 10:16:08.374719+00	active	\N	published	2025-11-03 10:16:05.429+00	2025-11-03 10:16:04.977+00	f
02bcad3f-8214-423f-8ada-b60ded499b9a	live	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-03T16:37:38.423Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	Manual publish	toofunnysketch@gmail.com	2025-11-03 16:37:38.620283+00	active	\N	published	2025-11-03 16:37:38.423+00	2025-11-03 16:37:37.814+00	f
5cbb04d2-231b-4734-8552-c858b35e556e	live	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-04T01:30:00.427Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	Manual publish	kmiko28@gmail.com	2025-11-04 01:30:02.00859+00	active	\N	published	2025-11-04 01:30:00.427+00	2025-11-04 01:29:59.998+00	f
8b2502e4-0375-4df8-8bf0-004144d45a6d	live	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": null, "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-03T16:33:30.388Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	About us change	toofunnysketch@gmail.com	2025-11-03 16:33:30.558244+00	active	\N	published	2025-11-29 05:50:56.67+00	2025-11-03 16:33:29.699+00	f
20b13d01-1938-4c16-abfe-e60efe6b2249	live	{"logo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TFPLOGO", "theme_bg": "linear-gradient(to right, #000, #1a1a40)", "who_body": null, "footer_bg": "#000000", "header_bg": "#000000", "who_title": null, "about_body": "Too Funny Productions is an independent entertainment collective based in St. Louis, creating bold, original, and unapologetically funny content for the stage and screen. From sketch shows and web series to films, commercials, and podcasts, we’re building a creative home where authentic voices and wild ideas thrive. Our mission is to make people laugh, think, and connect through storytelling that pushes boundaries and celebrates culture — one production at a time.", "about_team": [{"bio": "Donovan “Too T3rpd” C is a St. Louis–based comedian, host, and creative force behind the upcoming sketch show Too Funny. Known for his sharp improv instincts and ability to build larger-than-life characters, Donovan blends improv, sketch, and storytelling into a bold, unpredictable comedy style. He’s also the creator of the Too T3rpd podcast, exploring cannabis culture and local creatives. With Too Funny: The Prequel, Donovan and the team are building a universe of unforgettable characters while inviting audiences to laugh at the chaos of creation itself.", "name": "Donovan", "title": "Performer, Writer, Director", "socials": [{"url": "https://x.com/donovan2408", "label": "X"}, {"url": "https://www.patreon.com/c/TOOT3RPD/home?utm_source=join_link&utm_medium=unknown&utm_campaign=creatorshare_creator&utm_content=copyLink", "label": "Patreon"}, {"url": "https://www.youtube.com/channel/UCwKBdB3EkP_zfvS_q-lo8zQ", "label": "YouTube"}, {"url": "https://linktr.ee/DonovanC", "label": "Linktree"}, {"url": "https://www.instagram.com/donovan2408", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086584315_Copy%20of%20IMG_6589%20-%20TooT3rpd%20Podcast.jpg"}, {"bio": "Lucius is a writer, performer, and musician. They are a Midwestern dude with goofball in their veins. Lucius has been chasing the comedy high since being exiled to the hallway for disrupting class. Outside of sketch, they love combining comedy and music. Most notable songs being “Oops! I’m Too High” and “Step Your Bussy Up”. ", "name": "Lucius Rawley", "title": "Performer, Writer, Tech, Director", "socials": [{"url": "https://www.instagram.com/luciusmcqueen?igsh=MXJuNWs5bndubXh1MQ%3D%3D&utm_source=qr", "label": "Instagram"}, {"url": "https://www.tiktok.com/@luciusmcqueen?_t=ZP-8zYmcwKyIHO&_r=1", "label": "TikTok"}, {"url": "https://open.spotify.com/artist/6FcvnsmJa2ND21hTJBME0W?si=D8kjtXi3Qo-DWKTBRJriwQ", "label": "Spotify"}, {"url": "https://linktr.ee/luciusmcqueen?fbclid=PAZXh0bgNhZW0CMTEAAac8lbF374tizE9PhjJtXPg2hU8hau5oLC2NdWcY5n_zhFecXlUwNZXmmjvIOQ_aem_SGzYCJL3qZxbWXwosu9_bw", "label": "Linktree"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086586232_Copy%20of%20PSX_20240406_175942%20-%20Lucius%20McQueen.jpeg"}, {"bio": "Maggie has been part of the improv community since 2023. She performs regularly with teams 80085, Stay Tuned, and Rascals, and loves exploring what she can get away with on stage with a variety of other teams and forms as well. Too Funny is her writing debut. If Maggie was a Powerpuff girl, instead of “sugar, spice, and everything nice,” it’d be “goofy, raunchy, and everything dumb.” She IS an idiot, but boy does she have fun with it. ", "name": "Maggie Hagen", "title": "Performer, Writer", "socials": [{"url": "https://www.instagram.com/maggie_hagen?igsh=eG13N2Z0aXluemR3&utm_source=qr", "label": "Instagram"}], "photo_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1761086583480_Copy%20of%20IMG_2295%20-%20Margaret%20Hagen.jpeg"}], "hero_title": "Comedy That's TOO FUNNY", "site_title": null, "updated_at": "2025-11-29T05:50:56.286Z", "about_title": null, "events_past": [{"date": "Saturday, August 23, 2025 at 8 PM", "link": "https://www.facebook.com/events/758903603166971", "title": "Too Funny: The Prequel", "venue": "The Improv Shop - STL"}], "favicon_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "footer_text": null, "media_intro": null, "media_title": null, "merch_intro": null, "merch_items": [], "merch_title": null, "who_cta_url": null, "contactemail": "info@toofunnyproductions.com", "contactphone": null, "events_intro": null, "events_title": null, "footer_links": [], "hero_subtext": "Original sketch, live shows, and shamelessly fun chaos.", "theme_accent": "#FFD700", "contact_cards": [], "contact_intro": null, "contact_title": null, "site_keywords": null, "who_cta_label": null, "who_image_url": null, "hero_image_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/TooFunny.png", "media_sections": [{"items": [{"url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "type": "video", "title": "Main TFP Video!"}], "title": "Newest Videos!"}], "contact_socials": {"youtube": "https://www.youtube.com/@TooFunnySketch", "instagram": "https://www.instagram.com/toofunnysketch/?hl=en"}, "events_upcoming": [], "hero_badge_size": "medium", "hero_title_size": "large", "about_team_intro": null, "site_description": null, "theme_use_global": true, "admin_quick_links": [{"url": "https://drive.google.com/drive/folders/1xiKQxsWjTknIRS6tTS1TZiOys9JF_Xf6", "label": "Admin Documents"}], "hero_subtext_size": "medium", "about_mission_body": null, "featured_video_url": "https://vaxpealnyglmhghyspcu.supabase.co/storage/v1/object/public/media/1760054891867_TFPMainVideo.mp4", "about_mission_title": null, "maintenance_enabled": null, "maintenance_message": null, "hero_badge_font_size": null, "hero_title_font_size": null, "maintenance_timezone": null, "maintenance_daily_end": null, "hero_subtext_font_size": null, "maintenance_daily_start": null, "session_timeout_minutes": 5, "maintenance_schedule_enabled": null}	Manual publish	kmiko28@gmail.com	2025-11-29 05:50:58.594104+00	active	\N	published	2025-11-29 05:50:56.67+00	2025-11-29 05:50:55.141+00	t
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type) FROM stdin;
media	media	\N	2025-10-05 22:56:11.219401+00	2025-10-05 22:56:11.219401+00	t	f	\N	\N	\N	STANDARD
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.buckets_analytics (name, type, format, created_at, updated_at, id, deleted_at) FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.buckets_vectors (id, type, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.migrations (id, name, hash, executed_at) FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2025-10-03 20:28:13.733452
1	initialmigration	6ab16121fbaa08bbd11b712d05f358f9b555d777	2025-10-03 20:28:13.783776
2	storage-schema	5c7968fd083fcea04050c1b7f6253c9771b99011	2025-10-03 20:28:14.018614
3	pathtoken-column	2cb1b0004b817b29d5b0a971af16bafeede4b70d	2025-10-03 20:28:14.070434
4	add-migrations-rls	427c5b63fe1c5937495d9c635c263ee7a5905058	2025-10-03 20:28:14.137461
5	add-size-functions	79e081a1455b63666c1294a440f8ad4b1e6a7f84	2025-10-03 20:28:14.176519
6	change-column-name-in-get-size	f93f62afdf6613ee5e7e815b30d02dc990201044	2025-10-03 20:28:14.186579
7	add-rls-to-buckets	e7e7f86adbc51049f341dfe8d30256c1abca17aa	2025-10-03 20:28:14.194487
8	add-public-to-buckets	fd670db39ed65f9d08b01db09d6202503ca2bab3	2025-10-03 20:28:14.202082
9	fix-search-function	3a0af29f42e35a4d101c259ed955b67e1bee6825	2025-10-03 20:28:14.211026
10	search-files-search-function	68dc14822daad0ffac3746a502234f486182ef6e	2025-10-03 20:28:14.221736
11	add-trigger-to-auto-update-updated_at-column	7425bdb14366d1739fa8a18c83100636d74dcaa2	2025-10-03 20:28:14.228474
12	add-automatic-avif-detection-flag	8e92e1266eb29518b6a4c5313ab8f29dd0d08df9	2025-10-03 20:28:14.237517
13	add-bucket-custom-limits	cce962054138135cd9a8c4bcd531598684b25e7d	2025-10-03 20:28:14.244513
14	use-bytes-for-max-size	941c41b346f9802b411f06f30e972ad4744dad27	2025-10-03 20:28:14.25271
15	add-can-insert-object-function	934146bc38ead475f4ef4b555c524ee5d66799e5	2025-10-03 20:28:14.311332
16	add-version	76debf38d3fd07dcfc747ca49096457d95b1221b	2025-10-03 20:28:14.324744
17	drop-owner-foreign-key	f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101	2025-10-03 20:28:14.331886
18	add_owner_id_column_deprecate_owner	e7a511b379110b08e2f214be852c35414749fe66	2025-10-03 20:28:14.341505
19	alter-default-value-objects-id	02e5e22a78626187e00d173dc45f58fa66a4f043	2025-10-03 20:28:14.350142
20	list-objects-with-delimiter	cd694ae708e51ba82bf012bba00caf4f3b6393b7	2025-10-03 20:28:14.356882
21	s3-multipart-uploads	8c804d4a566c40cd1e4cc5b3725a664a9303657f	2025-10-03 20:28:14.365111
22	s3-multipart-uploads-big-ints	9737dc258d2397953c9953d9b86920b8be0cdb73	2025-10-03 20:28:14.384298
23	optimize-search-function	9d7e604cddc4b56a5422dc68c9313f4a1b6f132c	2025-10-03 20:28:14.39883
24	operation-function	8312e37c2bf9e76bbe841aa5fda889206d2bf8aa	2025-10-03 20:28:14.405532
25	custom-metadata	d974c6057c3db1c1f847afa0e291e6165693b990	2025-10-03 20:28:14.422834
26	objects-prefixes	ef3f7871121cdc47a65308e6702519e853422ae2	2025-10-03 20:28:14.439422
27	search-v2	33b8f2a7ae53105f028e13e9fcda9dc4f356b4a2	2025-10-03 20:28:14.458806
28	object-bucket-name-sorting	ba85ec41b62c6a30a3f136788227ee47f311c436	2025-10-03 20:28:14.826489
29	create-prefixes	a7b1a22c0dc3ab630e3055bfec7ce7d2045c5b7b	2025-10-03 20:28:14.832777
30	update-object-levels	6c6f6cc9430d570f26284a24cf7b210599032db7	2025-10-03 20:28:14.839914
31	objects-level-index	33f1fef7ec7fea08bb892222f4f0f5d79bab5eb8	2025-10-03 20:28:14.847617
32	backward-compatible-index-on-objects	2d51eeb437a96868b36fcdfb1ddefdf13bef1647	2025-10-03 20:28:14.856629
33	backward-compatible-index-on-prefixes	fe473390e1b8c407434c0e470655945b110507bf	2025-10-03 20:28:14.864974
34	optimize-search-function-v1	82b0e469a00e8ebce495e29bfa70a0797f7ebd2c	2025-10-03 20:28:14.86796
35	add-insert-trigger-prefixes	63bb9fd05deb3dc5e9fa66c83e82b152f0caf589	2025-10-03 20:28:14.876504
36	optimise-existing-functions	81cf92eb0c36612865a18016a38496c530443899	2025-10-03 20:28:14.884491
37	add-bucket-name-length-trigger	3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1	2025-10-03 20:28:14.910939
38	iceberg-catalog-flag-on-buckets	19a8bd89d5dfa69af7f222a46c726b7c41e462c5	2025-10-03 20:28:14.917634
39	add-search-v2-sort-support	39cf7d1e6bf515f4b02e41237aba845a7b492853	2025-10-03 20:28:14.937584
40	fix-prefix-race-conditions-optimized	fd02297e1c67df25a9fc110bf8c8a9af7fb06d1f	2025-10-03 20:28:14.944802
41	add-object-level-update-trigger	44c22478bf01744b2129efc480cd2edc9a7d60e9	2025-10-03 20:28:14.955069
42	rollback-prefix-triggers	f2ab4f526ab7f979541082992593938c05ee4b47	2025-10-03 20:28:14.962515
43	fix-object-level	ab837ad8f1c7d00cc0b7310e989a23388ff29fc6	2025-10-03 20:28:14.970744
44	vector-bucket-type	99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3	2025-11-18 06:01:45.557111
45	vector-buckets	049e27196d77a7cb76497a85afae669d8b230953	2025-11-18 06:01:46.24838
46	buckets-objects-grants	fedeb96d60fefd8e02ab3ded9fbde05632f84aed	2025-11-18 06:01:46.664717
47	iceberg-table-metadata	649df56855c24d8b36dd4cc1aeb8251aa9ad42c2	2025-11-18 06:01:46.864242
48	iceberg-catalog-ids	2666dff93346e5d04e0a878416be1d5fec345d6f	2025-11-18 06:01:46.954742
49	buckets-objects-grants-postgres	072b1195d0d5a2f888af6b2302a1938dd94b8b3d	2025-12-21 20:58:02.707741
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.objects (id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, version, owner_id, user_metadata, level) FROM stdin;
0890d28b-5f15-47e0-ad34-3ec14914a49c	media	incoming/1759705225629-TooFunnyThePrequel.png	\N	2025-10-05 23:00:27.182214+00	2025-10-05 23:00:27.182214+00	2025-10-05 23:00:27.182214+00	{"eTag": "\\"dbdf62a3611ea9c9f3785cf3fcd4137e\\"", "size": 143407, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-05T23:00:28.000Z", "contentLength": 143407, "httpStatusCode": 200}	06fcedbc-c581-4423-a74f-124fe0e4e812	\N	{}	2
2cf47e3a-3a9a-4624-a860-17d10dc0e67a	media	uploads/1759712076071_TooFunnyThePrequel.png	\N	2025-10-06 00:54:37.881154+00	2025-10-06 00:54:37.881154+00	2025-10-06 00:54:37.881154+00	{"eTag": "\\"dbdf62a3611ea9c9f3785cf3fcd4137e\\"", "size": 143407, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-06T00:54:38.000Z", "contentLength": 143407, "httpStatusCode": 200}	e7f6ccea-b150-4373-833b-3f74b2a1edb1	\N	{}	2
519ee936-cf66-4293-a71f-918f265b31c3	media	uploads/1759805446478_TooFunnyThePrequel.png	\N	2025-10-07 02:50:48.832386+00	2025-10-07 02:50:48.832386+00	2025-10-07 02:50:48.832386+00	{"eTag": "\\"dbdf62a3611ea9c9f3785cf3fcd4137e\\"", "size": 143407, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-07T02:50:49.000Z", "contentLength": 143407, "httpStatusCode": 200}	9c3c887e-ce06-4f07-b472-283ffd9c8157	\N	{}	2
628e3d04-bed6-467b-bc0e-f6e05fc21395	media	uploads/1759805615106_TooFunnyThePrequel.png	\N	2025-10-07 02:53:37.254389+00	2025-10-07 02:53:37.254389+00	2025-10-07 02:53:37.254389+00	{"eTag": "\\"dbdf62a3611ea9c9f3785cf3fcd4137e\\"", "size": 143407, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-07T02:53:38.000Z", "contentLength": 143407, "httpStatusCode": 200}	59fb335b-46f3-470f-9dd8-e247233fd0d3	\N	{}	2
17b4014e-d50b-4108-b6e1-9d4c13f3b8ce	media	uploads/1759959683101_TFPMainVideo1.mp4	\N	2025-10-08 21:41:25.643961+00	2025-10-08 21:41:25.643961+00	2025-10-08 21:41:25.643961+00	{"eTag": "\\"f01dc79709ff882964930bcfe7fd0459-3\\"", "size": 13606387, "mimetype": "video/mp4", "cacheControl": "max-age=3600", "lastModified": "2025-10-08T21:41:26.000Z", "contentLength": 13606387, "httpStatusCode": 200}	541def6d-3dea-4490-98ba-12890656cafe	\N	{}	2
72bd08e5-dd14-4e5f-b937-a1fce682a2bf	media	1760047204508_hoodie.jpg	\N	2025-10-09 22:00:05.802576+00	2025-10-09 22:00:05.802576+00	2025-10-09 22:00:05.802576+00	{"eTag": "\\"6300a28341b27788de6d5bb347ceb102\\"", "size": 54222, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-09T22:00:06.000Z", "contentLength": 54222, "httpStatusCode": 200}	c8f294cf-9dea-4467-a213-9e1cbacf8ea9	\N	{}	1
4f5fd3a4-92e2-4457-9d66-e22aeed8ab76	media	1760047204781_all four.jpg	\N	2025-10-09 22:00:06.169391+00	2025-10-09 22:00:06.169391+00	2025-10-09 22:00:06.169391+00	{"eTag": "\\"3ab79cba7604ec88f699b510b586ab46\\"", "size": 44863, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-09T22:00:07.000Z", "contentLength": 44863, "httpStatusCode": 200}	dfa804e7-07f1-4803-bc32-fbb0d5f10b70	\N	{}	1
35abcf9c-0860-4a61-9d6d-0e292e4fcfe1	media	1760054891867_TFPMainVideo.mp4	\N	2025-10-10 00:08:14.80931+00	2025-10-10 00:08:14.80931+00	2025-10-10 00:08:14.80931+00	{"eTag": "\\"e05d1e39bf13762b260026952d6536b7-2\\"", "size": 9558553, "mimetype": "video/mp4", "cacheControl": "max-age=3600", "lastModified": "2025-10-10T00:08:15.000Z", "contentLength": 9558553, "httpStatusCode": 200}	023ee83b-5555-43a4-8c22-8850feb08848	\N	{}	1
06a83295-3210-4ca9-b2d7-b1e3315896d8	media	1761086583480_Copy of IMG_2295 - Margaret Hagen.jpeg	\N	2025-10-21 22:43:05.950192+00	2025-10-21 22:43:05.950192+00	2025-10-21 22:43:05.950192+00	{"eTag": "\\"b6da6716cd0342783cff7155012d2ac8\\"", "size": 3151414, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-21T22:43:06.000Z", "contentLength": 3151414, "httpStatusCode": 200}	8b289482-9c9e-4dde-8b8b-7440a0b4e824	\N	{}	1
ad97ba34-c36f-4c87-b143-684324ec2d54	media	1761086584315_Copy of IMG_6589 - TooT3rpd Podcast.jpg	\N	2025-10-21 22:43:06.931071+00	2025-10-21 22:43:06.931071+00	2025-10-21 22:43:06.931071+00	{"eTag": "\\"b06cc9c08bd9188467511baced1f99c2-2\\"", "size": 7716137, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-21T22:43:07.000Z", "contentLength": 7716137, "httpStatusCode": 200}	4ea32e6f-13ea-4cba-8b34-1dc4b85a6430	\N	{}	1
a870dabc-2854-4227-aea7-1bbeda1d0db4	media	1761086585243_Copy of IMG_6626 - Erin Pazderka.jpeg	\N	2025-10-21 22:43:07.26151+00	2025-10-21 22:43:07.26151+00	2025-10-21 22:43:07.26151+00	{"eTag": "\\"039bbafac5136b2a83263c3508ecab85\\"", "size": 674284, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-21T22:43:08.000Z", "contentLength": 674284, "httpStatusCode": 200}	1b5325b7-84a6-4f09-b925-8b4da1261811	\N	{}	1
8d4baff1-3c4b-4600-ae22-ea3998b4a687	media	1761086585569_Copy of Photo Nov 27 2024, 7 05 02 AM - Angela Mayer.jpg	\N	2025-10-21 22:43:07.907257+00	2025-10-21 22:43:07.907257+00	2025-10-21 22:43:07.907257+00	{"eTag": "\\"85a560c3ec29a20eed11bac248fa48a9\\"", "size": 2918122, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-21T22:43:08.000Z", "contentLength": 2918122, "httpStatusCode": 200}	47604c90-e06e-4fd2-8d44-35206f577c8f	\N	{}	1
722d0c7e-299a-4f88-888f-ae57c85965d6	media	1761086586232_Copy of PSX_20240406_175942 - Lucius McQueen.jpeg	\N	2025-10-21 22:43:08.224651+00	2025-10-21 22:43:08.224651+00	2025-10-21 22:43:08.224651+00	{"eTag": "\\"a122d23261e87b88c61ef3a88bade034\\"", "size": 404733, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-21T22:43:09.000Z", "contentLength": 404733, "httpStatusCode": 200}	4026472e-d947-4c57-b01a-f89812f4b384	\N	{}	1
825754da-d679-4400-8796-a4cfebd80749	media	1761094930372_PartyTime.jpg	\N	2025-10-22 01:02:12.839438+00	2025-10-22 01:02:12.839438+00	2025-10-22 01:02:12.839438+00	{"eTag": "\\"360e3f87d720de5a1823997441d2a5d3\\"", "size": 38290, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2025-10-22T01:02:13.000Z", "contentLength": 38290, "httpStatusCode": 200}	ac6163ff-0164-4efc-a6e5-8e50165075c8	\N	{}	1
4a982d20-84a9-46fe-bd9c-270039e969a6	media	TooFunny.png	\N	2025-10-25 06:31:57.349968+00	2025-10-25 06:31:57.349968+00	2025-10-25 06:31:57.349968+00	{"eTag": "\\"00c9350e88b2a58d17a974200b77cf22\\"", "size": 44908, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-25T06:31:58.000Z", "contentLength": 44908, "httpStatusCode": 200}	45703051-f323-4707-a5bb-3838f7e06d67	\N	{}	1
7a41049b-a984-498e-934e-55e746783252	media	TFPLOGO	\N	2025-10-25 19:08:50.313393+00	2025-10-25 19:08:50.313393+00	2025-10-25 19:08:50.313393+00	{"eTag": "\\"90ad9ac36b48491e2bf57fbd8a0ad2aa\\"", "size": 344540, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-10-25T19:08:51.000Z", "contentLength": 344540, "httpStatusCode": 200}	e941b860-588e-404a-962f-7ee225ad3678	\N	{}	1
8e52f01e-629f-4444-a165-dbe6fc75eb87	media	1764395434775_TFP.png	\N	2025-11-29 05:50:37.373639+00	2025-11-29 05:50:37.373639+00	2025-11-29 05:50:37.373639+00	{"eTag": "\\"90ad9ac36b48491e2bf57fbd8a0ad2aa\\"", "size": 344540, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2025-11-29T05:50:38.000Z", "contentLength": 344540, "httpStatusCode": 200}	bddd6ebb-691e-4078-98ce-82cc8bd4242f	\N	{}	1
\.


--
-- Data for Name: prefixes; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.prefixes (bucket_id, name, created_at, updated_at) FROM stdin;
media	incoming	2025-10-05 23:00:27.182214+00	2025-10-05 23:00:27.182214+00
media	uploads	2025-10-06 00:54:37.881154+00	2025-10-06 00:54:37.881154+00
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at, user_metadata) FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.s3_multipart_uploads_parts (id, upload_id, size, part_number, bucket_id, key, etag, owner_id, version, created_at) FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.vector_indexes (id, name, bucket_id, data_type, dimension, distance_metric, metadata_configuration, created_at, updated_at) FROM stdin;
\.


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: merch merch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch
    ADD CONSTRAINT merch_pkey PRIMARY KEY (id);


--
-- Name: settings_deployments settings_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_deployments
    ADD CONSTRAINT settings_deployments_pkey PRIMARY KEY (id);


--
-- Name: settings_draft settings_draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_draft
    ADD CONSTRAINT settings_draft_pkey PRIMARY KEY (id);


--
-- Name: settings_lock settings_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_lock
    ADD CONSTRAINT settings_lock_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings_versions settings_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_versions
    ADD CONSTRAINT settings_versions_pkey PRIMARY KEY (id);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: prefixes prefixes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT prefixes_pkey PRIMARY KEY (bucket_id, level, name);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: idx_admin_actions_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_action ON public.admin_actions USING btree (action);


--
-- Name: idx_admin_actions_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_actor ON public.admin_actions USING btree (actor_email);


--
-- Name: idx_admin_actions_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_occurred_at ON public.admin_actions USING btree (occurred_at DESC);


--
-- Name: idx_settings_deployments_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_deployments_start ON public.settings_deployments USING btree (start_at);


--
-- Name: idx_settings_deployments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_deployments_status ON public.settings_deployments USING btree (status);


--
-- Name: idx_settings_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_updated_at ON public.settings USING btree (updated_at);


--
-- Name: idx_settings_versions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_versions_created ON public.settings_versions USING btree (created_at DESC);


--
-- Name: idx_settings_versions_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_versions_kind ON public.settings_versions USING btree (kind);


--
-- Name: idx_settings_versions_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_versions_stage ON public.settings_versions USING btree (stage);


--
-- Name: idx_settings_versions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_versions_status ON public.settings_versions USING btree (status);


--
-- Name: only_one_settings_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX only_one_settings_row ON public.settings USING btree ((true));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_name_bucket_level_unique; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_name_bucket_level_unique ON storage.objects USING btree (name COLLATE "C", bucket_id, level);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_lower_name ON storage.objects USING btree ((path_tokens[level]), lower(name) text_pattern_ops, bucket_id, level);


--
-- Name: idx_prefixes_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_prefixes_lower_name ON storage.prefixes USING btree (bucket_id, level, ((string_to_array(name, '/'::text))[level]), lower(name) text_pattern_ops);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_bucket_id_level_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX objects_bucket_id_level_idx ON storage.objects USING btree (bucket_id, level, name COLLATE "C");


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: settings_draft trg_settings_draft_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settings_draft_updated BEFORE UPDATE ON public.settings_draft FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: settings_public trg_settings_public_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settings_public_updated BEFORE UPDATE ON public.settings_public FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: objects objects_delete_delete_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- Name: objects objects_insert_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();


--
-- Name: objects objects_update_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();


--
-- Name: prefixes prefixes_create_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();


--
-- Name: prefixes prefixes_delete_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: settings_deployments settings_deployments_fallback_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_deployments
    ADD CONSTRAINT settings_deployments_fallback_snapshot_id_fkey FOREIGN KEY (fallback_snapshot_id) REFERENCES public.settings_versions(id) ON DELETE SET NULL;


--
-- Name: settings_deployments settings_deployments_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_deployments
    ADD CONSTRAINT settings_deployments_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.settings_versions(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: prefixes prefixes_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT "prefixes_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: settings Allow anon read access to settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow anon read access to settings" ON public.settings FOR SELECT TO anon USING (true);


--
-- Name: settings Allow authenticated updates to settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated updates to settings" ON public.settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: admin_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_actions admin_actions_service_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_actions_service_read ON public.admin_actions FOR SELECT USING ((auth.uid() IS NULL));


--
-- Name: contact_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

--
-- Name: merch; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merch ENABLE ROW LEVEL SECURITY;

--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: objects Allow public read 1ps738_0; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Allow public read 1ps738_0" ON storage.objects FOR SELECT USING ((bucket_id = 'media'::text));


--
-- Name: objects Allow uploads for authenticated or anon users 1ps738_0; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Allow uploads for authenticated or anon users 1ps738_0" ON storage.objects FOR INSERT WITH CHECK ((bucket_id = 'media'::text));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: prefixes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.prefixes ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict YgeqiGl5ganw2GaUdwE23TnDuPavFcArbGNgxd6mXVFjB9atSnfQPxF42hn7PbL

