export const VERSION='brain-segments/2';
export const dimensions=[
 ['relationship','Vínculo com a Apito'],['sector','Setor e tipo de empresa'],['professional','Área profissional e contratação'],['origin','Origem do cadastro e negociação'],['location','Localização'],['service','Serviço e interesse'],['event','Tipo de evento'],['calendar','Data e sazonalidade'],['size','Participantes e características'],['pipeline','Etapa e encerramento'],['history','Histórico e valor comercial'],['care','Atendimento e próxima ação'],['channels','Canais e preferências'],['quality','Qualidade e confiabilidade']
];
const f=(key,label,dimension,type='text',entity='any',manual=true)=>({key,label,dimension,type,entity,manual});
export const fields=[
 f('relationship','Vínculo com a Apito','relationship'),f('nature','Natureza do cadastro','relationship'),
 f('sector','Setor','sector'),f('subsector','Subsetor','sector'),f('unit','Matriz, filial ou unidade','sector'),
 f('job_title','Cargo','professional'),f('job_function','Função declarada na agenda','professional'),f('department','Área profissional','professional'),f('purchase_role','Papel na contratação','professional'),f('specialty','Especialidade','professional'),
 f('source','Origem comprovada do cadastro','origin','text','any',false),f('acquisition','Origem da negociação','origin','text','opportunity'),
 f('contact_city','Cidade do contato','location','text','contact'),f('contact_state','Estado do contato','location','text','contact'),f('company_city','Cidade da empresa','location','text','company'),f('company_state','Estado da empresa','location','text','company'),f('event_location','Local do evento','location','text','opportunity'),f('service_area','Área de atendimento','location'),
 f('interest','Interesse declarado','service'),f('service_quoted','Serviço cotado','service','text','opportunity'),f('service_contracted','Serviço contratado','service','text','opportunity'),f('service_delivered','Serviço realizado','service','text','opportunity'),f('briefing_objective','Objetivo do briefing','service','text','opportunity'),
 f('event_type','Tipo de evento normalizado','event','text','opportunity'),f('event_subtype','Subtipo de evento','event','text','opportunity'),
 f('event_date','Data do evento','calendar','date','opportunity'),f('event_month','Mês do evento','calendar','number','opportunity',false),f('event_year','Ano do evento','calendar','number','opportunity',false),f('days_to_event','Dias até o evento','calendar','number','opportunity',false),f('event_situation','Situação do evento','calendar','text','opportunity'),f('season','Ocasião documentada','calendar','text','opportunity'),
 f('participants','Quantidade de participantes','size','number','opportunity'),f('duration','Duração','size','text','opportunity'),f('event_format','Formato','size','text','opportunity'),f('requirements','Estrutura necessária','size','text','opportunity'),
 f('account_id','Conta na origem','pipeline','text','opportunity',false),f('pipeline_id','ID do funil na origem','pipeline','text','opportunity',false),f('status_id','ID da etapa na origem','pipeline','text','opportunity',false),f('pipeline_name','Funil','pipeline','text','opportunity',false),f('stage_name','Etapa registrada','pipeline','text','opportunity',false),f('technical_status','Estado técnico','pipeline','text','opportunity',false),f('commercial_result','Resultado comercial comprovado','pipeline','text','opportunity'),f('loss_reason','Motivo de encerramento','pipeline','text','opportunity'),f('proposal','Referência da proposta','pipeline','text','opportunity'),
 f('opportunities_count','Oportunidades vinculadas','history','number','any',false),f('confirmed_contracts','Contratações distintas confirmadas','history','number'),f('last_contract','Última contratação confirmada','history','date'),f('recurrence_12m','Contratações distintas em 12 meses','history','number'),f('recurrence_24m','Contratações distintas em 24 meses','history','number'),f('quoted_value','Valor proposto (moeda não validada)','history','number','opportunity',false),f('won_value','Valor ganho confirmado','history','number','opportunity'),f('received_value','Valor recebido confirmado','history','number','opportunity'),
 f('owner','Responsável na fonte','care','text','opportunity',false),f('attendant','Atendente','care','text','opportunity'),f('task_open','Tarefa aberta','care','boolean','any',false),f('task_overdue','Tarefa vencida','care','boolean','any',false),f('return_date','Retorno agendado','care','date','opportunity'),f('meeting_date','Reunião marcada','care','date','opportunity'),f('operational_pending','Pendência operacional','care'),f('last_reply','Última resposta comprovada','care','date'),
 f('has_phone','Telefone preenchido','channels','boolean','contact',false),f('phone_normalized','Telefone normalizado na fonte','channels','boolean','contact',false),f('has_email','E-mail preenchido','channels','boolean','contact',false),f('email_valid','E-mail com formato válido','channels','boolean','contact',false),f('channel_history','Canal com histórico identificado','channels'),f('preferred_channel','Canal preferido confirmado','channels'),f('restricted_channel','Restrição por canal','channels'),
 f('incomplete','Cadastro incompleto','quality','boolean','contact',false),f('missing_company','Empresa não identificada','quality','boolean','contact',false),f('generic_name','Nome genérico — sugestão','quality','boolean','any',true),f('duplicate_candidate','Possível duplicidade','quality','boolean','contact',false),f('ambiguous_identity','Correspondência ambígua','quality','boolean','any',false),f('review_needed','Há sugestão ou conflito','quality','boolean','any',false),f('identity_review','Decisão da revisão de identidade','quality')
];
export const dictionaries={
 relationship:['Cliente','Potencial cliente','Parceiro ou indicador','Fornecedor','Profissional artístico ou técnico','Equipe interna','Contato pessoal','Cadastro de teste'],
 nature:['Pessoa','Organização','Contato de função'],
 sector:['Agências e produtoras','Hotelaria e turismo','Espaços e lazer','RH e treinamento','Comércio e varejo','Indústria','Finanças e seguros','Tecnologia e telecomunicações','Saúde e farmacêutico','Educação','Serviços profissionais','Cultura e entretenimento','Outros'],
 unit:['Matriz','Filial','Franquia','Unidade'],
 department:['RH','Desenvolvimento de pessoas','Marketing','Eventos','Compras','Comercial','Financeiro','Produção'],
 purchase_role:['Solicitante','Organizador','Influenciador','Decisor','Comprador','Aprovador financeiro','Intermediário'],
 specialty:['Percussão','Canto','Dança','Produção','Áudio','Iluminação','Audiovisual','Transporte','Figurino'],
 interest:['Desenvolvimento e integração de equipes','Palestras','Atrações de samba e carnaval','Bandas e apresentações musicais','Atrações complementares','Produção técnica e audiovisual','Composição e conteúdo musical'],
 event_type:['Corporativo','Desenvolvimento de equipes','Social','Ativações e experiências','Palestras','Logística','Gravação musical'],
 event_situation:['Em negociação','Confirmado','Cancelado','Realizado'],
 commercial_result:['Venda confirmada','Perda confirmada','Atendimento encerrado','Evento realizado'],
 preferred_channel:['E-mail','Telefone','WhatsApp'],restricted_channel:['E-mail','Telefone','WhatsApp'],
 identity_review:['Manter cadastros separados','Correspondência ainda não comprovada','Revisado; aguarda procedimento separado de vinculação']
};
for(const f of fields)f.choices=dictionaries[f.key]||([]);
export const fieldMap=new Map(fields.map(f=>[f.key,f]));
const leaf=(field,operator,value)=>({field,operator,...(value===undefined?{}:{value})});
const group=(scope,...rules)=>({op:'and',scope,rules});
const and=(...rules)=>({op:'and',rules});
const or=(...rules)=>({op:'or',rules});
const soon=()=>leaf('days_to_event','between',[0,30]);
export const templates=[
 ['quotes','Orçamentos enviados',group('opportunity',leaf('stage_name','contains','orçamento enviado'))],
 ['confirmed-soon','Eventos confirmados em até 30 dias',group('opportunity',soon(),leaf('event_situation','eq','Confirmado'))],
 ['open-soon','Oportunidades para eventos próximos',group('opportunity',soon(),leaf('event_situation','eq','Em negociação'))],
 ['cancelled-future','Eventos futuros cancelados',group('opportunity',leaf('days_to_event','gte',0),leaf('event_situation','eq','Cancelado'))],
 ['overdue','Tarefas vencidas',leaf('task_overdue','eq',true)],
 ['returns','Retornos agendados',group('opportunity',leaf('return_date','known'))],
 ['corporate','Corporativo e desenvolvimento de equipes',group('opportunity',or(leaf('event_type','eq','Corporativo'),leaf('event_type','eq','Desenvolvimento de equipes')))],
 ['agencies','Agências e produtoras contratantes',and(group('company',leaf('sector','contains','Agências e produtoras')),leaf('purchase_role','eq','Intermediário'))],
 ['venues','Hotelaria e espaços de eventos',group('company',or(leaf('sector','contains','Hotelaria'),leaf('sector','contains','Espaços e lazer')))],
 ['social','Eventos sociais',group('opportunity',leaf('event_type','eq','Social'))],
 ['professionals','Profissionais por especialidade',leaf('specialty','known')],
 ['recovery','Recuperação por motivo de encerramento',group('opportunity',or(leaf('commercial_result','eq','Perda confirmada'),leaf('commercial_result','eq','Atendimento encerrado')),leaf('loss_reason','known'))],
 ['repeat','Clientes com recorrência comercial',leaf('confirmed_contracts','gte',2)],
 ['iphone','Contatos originados da agenda',leaf('source','eq','iphone')],
 ['incomplete','Cadastros a completar',leaf('incomplete','eq',true)],
 ['identities','Identidades a revisar',or(leaf('duplicate_candidate','eq',true),leaf('ambiguous_identity','eq',true))]
].map(([key,name,criteria])=>({key,name,entity_kind:'contact',criteria,rule_version:VERSION}));
export const normalized=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
export function validRule(rule,depth=0,budget={left:80}) {
 if(!rule||typeof rule!=='object'||Array.isArray(rule)||depth>6||--budget.left<0)return false;
 if(rule.rules){return ['and','or','not'].includes(rule.op)&&(!rule.scope||['contact','company','opportunity'].includes(rule.scope))&&Array.isArray(rule.rules)&&rule.rules.length>0&&rule.rules.length<=30&&(rule.op!=='not'||rule.rules.length===1)&&rule.rules.every(r=>validRule(r,depth+1,budget));}
 const field=fieldMap.get(rule.field);if(!field)return false;
 if(!['eq','contains','gte','lte','between','known','unknown','conflict'].includes(rule.operator))return false;
 if(['known','unknown','conflict'].includes(rule.operator))return true;
 const value=rule.value;
 if(field.type==='number')return rule.operator==='between'?Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&value[0]<=value[1]:Number.isFinite(value);
 if(field.type==='boolean')return rule.operator==='eq'&&typeof value==='boolean';
 const isText=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('\0');
 const isDate=v=>isText(v)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(+new Date(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const valid=field.type==='date'?isDate:isText;
 return rule.operator==='between'?Array.isArray(value)&&value.length===2&&value.every(valid)&&value[0]<=value[1]:valid(value);
}
function compare(a,rule){
 if(rule.operator==='contains')return normalized(a).includes(normalized(rule.value));
 if(rule.operator==='eq')return typeof a==='string'?normalized(a)===normalized(rule.value):a===rule.value;
 if(rule.operator==='gte')return a>=rule.value;
 if(rule.operator==='lte')return a<=rule.value;
 if(rule.operator==='between')return a>=rule.value[0]&&a<=rule.value[1];
 return false;
}
export function evaluate(rule,entity,dataset){
 if(rule.rules){
  if(rule.scope){
   const linked=entity.kind===rule.scope?[entity]:(dataset.related.get(entity.uid)?.[rule.scope]||[]);
   if(!linked.length)return {match:null,proof:[{reason:'Vínculo não disponível',scope:rule.scope}]};
   const matches=linked.map(e=>evaluate({...rule,scope:undefined},e,dataset));
   const hit=matches.find(r=>r.match===true);return hit||{match:matches.some(r=>r.match===null)?null:false,proof:matches.flatMap(r=>r.proof).slice(0,8)};
  }
  const hits=rule.rules.map(r=>evaluate(r,entity,dataset));
  const match=rule.op==='not'?(hits[0].match===null?null:!hits[0].match):rule.op==='and'?(hits.some(r=>r.match===false)?false:hits.some(r=>r.match===null)?null:true):(hits.some(r=>r.match===true)?true:hits.some(r=>r.match===null)?null:false);
  return {match,proof:hits.flatMap(r=>r.proof).slice(0,30)};
 }
 const fact=entity.facts[rule.field];const values=Array.isArray(fact?.value)?fact.value:[fact?.value];
 const known=Boolean(fact&&fact.value!==null&&fact.value!==undefined&&fact.state!=='conflict'&&fact.state!=='suggested'&&fact.state!=='rejected'&&values.some(v=>v!==''));
 const match=rule.operator==='conflict'?fact?.state==='conflict':rule.operator==='unknown'?!known:rule.operator==='known'?known:known?values.some(v=>compare(v,rule)):null;
 return {match,proof:[{field:rule.field,label:fieldMap.get(rule.field)?.label,operator:rule.operator,expected:rule.value,entity_kind:entity.kind,entity_key:entity.key,fact:fact||null,matched:match}]};
}
