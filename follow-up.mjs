const followUpKeys = ['next_action', 'follow_up_on'];

export function writableFields(fields, body, updating) {
  // An older client may save a deal without knowing its scheduled follow-up.
  return fields.filter(key => !updating || !followUpKeys.includes(key) || Object.hasOwn(body, key));
}

export function followUpError({ next_action: action, follow_up_on: day }) {
  if (action != null && (typeof action !== 'string' || action.length > 200)) {
    return 'Descreva a próxima ação em até 200 caracteres.';
  }
  if (day == null || day === '') return '';
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(day) && !day.startsWith('0000')) {
    const date = new Date(day + 'T00:00:00Z');
    if (Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day) return '';
  }
  return 'Informe uma data de acompanhamento válida.';
}
