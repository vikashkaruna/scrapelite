-- 0065_entity_graph_taxonomy.sql — align the stored entity graph with §9.2.
--
-- Forward-only: 0056 is already deployable history. Its ids remain valid and
-- four missing entity concepts plus four missing relationships are added here.

alter table public.audit_entities
  drop constraint if exists audit_entities_entity_type_check;

alter table public.audit_entities
  add constraint audit_entities_entity_type_check check (entity_type in (
    'organization','brand','product','service','location','person','offer',
    'review','credential','event','content_asset','topic','industry','audience',
    'partner','customer_case_study','directory_listing','competitor'
  ));

comment on table public.audit_entities is
  'A node in a business entity graph. Eighteen stable internal types cover all fifteen §9.2 semantic types plus offer, event, and topic implementation extensions.';

alter table public.audit_entity_relationships
  drop constraint if exists audit_entity_relationships_predicate_check;

alter table public.audit_entity_relationships
  add constraint audit_entity_relationships_predicate_check check (predicate in (
    'owns','offers','located_at','employs','part_of','same_as','about','serves','competes_with',
    'provides','founded_by','validated_by','listed_on'
  ));

comment on table public.audit_entity_relationships is
  'One entity-graph edge. Thirteen stable internal predicates cover all nine §9.2 relationships plus owns, part_of, same_as, and about implementation extensions; domains and ranges are enforced by entityGraph.validateRelation.';
