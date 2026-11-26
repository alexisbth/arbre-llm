-- "Next question here": the box the user tapped in the drawn tree. The next box added to the tree goes under it,
-- whatever box the assistant chose; then it is cleared, and the assistant chooses again.
alter table public.trees add column next_parent text check (char_length(next_parent) <= 100);
comment on column public.trees.next_parent is 'Box tapped in the drawn tree: the next box added goes under it, then this is cleared.';

-- Adds one box to a tree. Its parent is the tapped box if there is one, otherwise the parent given in node.
-- The row is locked while the box is added, so two boxes added at the same moment are both kept.
-- Returns the parent used, or null when the tree or the parent box does not exist.
-- Runs with the caller's rights (row-level security applies).
drop function public.add_tree_node(text, jsonb);
create function public.add_tree_node(tree_name text, node jsonb) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  tapped text;
  nodes jsonb;
  chosen text;
begin
  select t.next_parent, t.data -> 'nodes' into tapped, nodes
    from public.trees as t
   where t.user_id = (select auth.uid()) and t.name = tree_name
     for update;
  if not found then return null; end if;

  chosen := case when exists (select 1 from jsonb_array_elements(nodes) as n where n ->> 'id' = tapped)
                 then tapped else node ->> 'parent' end;
  if not exists (select 1 from jsonb_array_elements(nodes) as n where n ->> 'id' = chosen) then return null; end if;

  update public.trees as t
     set data = jsonb_set(t.data, '{nodes}', nodes || jsonb_build_array(jsonb_set(node, '{parent}', to_jsonb(chosen)))),
         next_parent = null
   where t.user_id = (select auth.uid()) and t.name = tree_name;
  return chosen;
end
$$;
revoke execute on function public.add_tree_node(text, jsonb) from public, anon;
grant execute on function public.add_tree_node(text, jsonb) to authenticated;
