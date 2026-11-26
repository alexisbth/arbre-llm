-- Ramifai trees used by the remote MCP connector: one row per tree, the tree itself in the app's JSON export format
-- ({ version, nodes, groups }). Row-level security: each signed-in user only reaches their own trees.
create table public.trees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name ~ '^[[:alnum:]_-]{1,100}$'),
  data jsonb not null check (jsonb_typeof(data -> 'nodes') = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.trees is 'Ramifai trees reachable by the remote MCP connector (one per row, app JSON format).';

alter table public.trees enable row level security;
create policy "Own trees: read" on public.trees for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own trees: create" on public.trees for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own trees: change" on public.trees for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own trees: delete" on public.trees for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.trees from anon;
grant select, insert, update, delete on public.trees to authenticated;

-- updated_at follows every change
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger trees_touch_updated_at before update on public.trees
  for each row execute function public.touch_updated_at();

-- Adds one box to a tree in a single statement, so two boxes added at the same moment never overwrite each other.
-- Returns false when the tree or the parent box does not exist. Runs with the caller's rights (row-level security applies).
create function public.add_tree_node(tree_name text, node jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.trees
     set data = jsonb_set(data, '{nodes}', (data -> 'nodes') || jsonb_build_array(node))
   where user_id = (select auth.uid())
     and name = tree_name
     and exists (select 1 from jsonb_array_elements(data -> 'nodes') as n where n ->> 'id' = node ->> 'parent');
  return found;
end
$$;
revoke execute on function public.add_tree_node(text, jsonb) from public, anon;
grant execute on function public.add_tree_node(text, jsonb) to authenticated;
