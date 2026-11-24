(() => {
  const panel=document.querySelector('#invitation');
  const actions=document.querySelector('#actions');
  const message=document.querySelector('#message');
  const formatter=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short', timeStyle:'short',timeZone:'America/Sao_Paulo'});
  let token='';
  try { token=decodeURIComponent(location.hash.slice(1)); } catch { /* Invalid link. */ }
  let busy=false;
  const node=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
  function button(label,action,primary=false) {
    const btn=node('button',label);
    btn.type='button';
    if (primary) btn.className='primary';
    btn.onclick=()=>send(action);
    return btn;
  }
  function render(invite) {
    const details=node('dl','');
    function field(label,value) { details.append(node('dt',label),node('dd',value)); }
    field('Função',invite.role_name);
    field('Início',formatter.format(new Date(invite.starts_at))+' (Brasília)');
    field('Término',formatter.format(new Date(invite.ends_at))+' (Brasília)');
    if (invite.location) field('Local',invite.location);
    panel.replaceChildren(node('h2',invite.event_name),details);
    actions.replaceChildren();
    if (invite.status==='confirmed') {
      message.textContent='Sua participação está confirmada.';
      if (invite.group_url) {
        const url=new URL(invite.group_url);
        if (url.origin==='https://chat.whatsapp.com' && !url.username && !url.password) {
          const link=node('a','Entrar no grupo do evento');
          link.href=url.href; link.rel='noreferrer'; link.className='primary';actions.append(link);
        }
      }
    } else if (invite.status==='declined') {
      message.textContent='Você recusou este convite.';
    } else if (invite.status==='invited') {
      message.textContent='Você tem disponibilidade para trabalhar neste evento?';
      actions.append(button('Confirmar participação','confirm',true),button('Recusar convite','decline'));
    } else {
      throw Error('Estado de convite desconhecido.');
    }
  }
  async function send(action) {
    if (busy) return;
    busy=true;
    actions.querySelectorAll('button').forEach(b=>{b.disabled=true;});
    message.textContent=action==='view'?'Carregando convite…':'Registrando resposta…';
    try {
      const result=await fetch('/api/staffing-invite',{
        method:'POST', cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action})
      });
      const body=await result.json().catch(()=>({}));
      if (!result.ok) {
        const error=Error(body.error || 'Não foi possível consultar este convite.');
        error.status=result.status;throw error;
      }
      render(body);
    } catch (error) {
      panel.replaceChildren();actions.replaceChildren();
      if (error.status===404 || error.status===410) {
        message.textContent=error.status===410?'O prazo deste convite terminou.':'Convite inválido ou substituído. Peça o link atual à produção.';
      } else {
        message.textContent=error.status===409 ? error.message : 'Não foi possível verificar o estado do convite. Consulte novamente antes de responder.';
        actions.append(button('Consultar convite novamente','view'));
      }
    } finally {busy=false;}
  }
  if (/^[a-f0-9]{64}$/.test(token)) send('view');
  else message.textContent='Convite incompleto. Abra o link individual enviado pela produção.';
})();
