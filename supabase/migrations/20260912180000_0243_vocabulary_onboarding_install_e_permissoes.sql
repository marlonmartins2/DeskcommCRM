-- Forward-fix de 0239: mantém a assinatura antiga, elimina a ambiguidade do
-- parâmetro default e fecha a nova SECURITY DEFINER ao browser.
begin;

CREATE OR REPLACE FUNCTION public.fn_aplicar_quadro_do_onboarding(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_nome text,
  p_slug text,
  p_etapas jsonb,
  p_vocabulary jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_resultado jsonb;
begin
  -- Reutiliza as recusas e a troca atômica da assinatura original (0156).
  v_resultado := public.fn_aplicar_quadro_do_onboarding(
    p_organization_id, p_pipeline_id, p_nome, p_slug, p_etapas
  );
  if v_resultado->>'ok' = 'true' and p_vocabulary is not null then
    update public.crm_pipelines set vocabulary = p_vocabulary, updated_at = now()
      where id = p_pipeline_id and organization_id = p_organization_id;
  end if;
  return v_resultado;
end;
$$;

revoke execute on function public.fn_aplicar_quadro_do_onboarding(uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_aplicar_quadro_do_onboarding(uuid, uuid, text, text, jsonb, jsonb)
  to service_role;

commit;
