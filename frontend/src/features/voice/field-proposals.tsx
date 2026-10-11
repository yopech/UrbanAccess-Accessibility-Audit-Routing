import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { extractMeasurementProposals, type FieldProposal } from '../../domain/speech-parser/index.js';
import { PARAMETER_LABELS, parseMeasurement } from '../../domain/measurements.js';
import { primaryMeasurement, type Audit, type AuditCommand } from '../../domain/audit-model.js';
import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';
import type { EditorController } from '../editor/editor-controller.js';
export function FieldProposals({ transcript, auditId, zoneId, elementId, editor, disabled }: {
  transcript: string; auditId: string; zoneId: string; elementId: string;
  editor: EditorController<Audit, AuditCommand>; disabled: boolean;
}) {
  const mounted = useRef(true); const live = useRef({transcript,disabled}); live.current = {transcript,disabled};
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const element = snapshot.value.elements[elementId];
  const proposals = useMemo(() => extractMeasurementProposals(transcript, element?.type ?? ''), [transcript,element?.type]);
  const [hidden, setHidden] = useState<readonly string[]>([]); const [busy, setBusy] = useState(false); const working = useRef(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const hide = (id: string) => setHidden(ids => [...ids,id]);
  const accept = async (proposal: FieldProposal) => {
    if (working.current || disabled || snapshot.locked) return;
    working.current = true; setBusy(true); setError(''); setStatus('');
    try {
      if ((await editor.flush()).kind !== 'saved') throw new Error('Сначала завершите сохранение или разрешите конфликт редакций.');
      if (!mounted.current || live.current.disabled || live.current.transcript !== transcript) throw new Error('Черновик изменился или панель закрыта. Проверьте предложение заново.');
      const fresh = editor.getSnapshot(); const original = fresh.value.elements[elementId];
      if (fresh.locked || fresh.value.archivedAt || fresh.value.id !== auditId || original?.zoneId !== zoneId) throw new Error('Исходная карточка недоступна для изменения.');
      if (!extractMeasurementProposals(transcript, original.type).some(item => item.id === proposal.id)) throw new Error('Текст предложения изменился. Проверьте новый вариант.');
      const text = String(proposal.value).replace('.', ',');
      const input = original.measurementInputs[proposal.parameter]; const existing = primaryMeasurement(fresh.value,elementId,proposal.parameter);
      const currentText = input?.text ?? existing?.raw.text ?? ''; const currentUnit = input?.unit ?? existing?.raw.unit;
      const identical = currentText === text && currentUnit === proposal.unit;
      if (currentText.trim() && !identical && !confirm(`В поле «${PARAMETER_LABELS[proposal.parameter]}» уже есть значение ${currentText} ${currentUnit ?? ''}. Заменить на ${text} ${proposal.unit}?`)) return;
      const parsed = parseMeasurement(proposal.parameter,text,proposal.unit);
      if (!parsed) throw new Error('Не удалось проверить числовое значение.');
      const norm = evaluateMeasurementNorm(proposal.parameter,parsed.normalized);
      // Both synchronous commands enter one editor batch and one revision transaction.
      editor.enqueue({type:'setMeasurementInput',elementId,parameter:proposal.parameter,input:{text,unit:proposal.unit}});
      if (!(existing?.raw.text === text && existing.raw.unit === proposal.unit)) editor.enqueue({type:'recordMeasurement',id:crypto.randomUUID(),elementId,parameter:proposal.parameter,text,unit:proposal.unit});
      if ((await editor.flush()).kind !== 'saved') throw new Error('Замер пока не сохранён. Он остаётся в очереди редактора; завершите сохранение или разрешите конфликт.');
      hide(proposal.id); setStatus(norm?.status === 'ok' ? 'Замер сохранён. Значение соответствует предварительному профилю.' : norm?.message ?? 'Замер сохранён.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось принять замер.'); }
    finally { working.current = false; setBusy(false); }
  };
  const visible = proposals.filter(proposal => !hidden.includes(proposal.id));
  if (!visible.length && !error && !status) return null;
  return <section className="field-proposals" aria-label="Предложения замеров из речи">
    {visible.length > 0 && <><h3>Найдены замеры</h3><p className="proposal-caption">Проверьте число и единицу. Замер сохраняется только после вашего подтверждения.</p></>}
    {visible.map(proposal => <div className="field-proposal" key={proposal.id}>
      <div className="proposal-value"><strong>{proposal.value.toLocaleString('ru-RU')} <span>{({mm:'мм',cm:'см',m:'м','%':'%',deg:'°'})[proposal.unit]}</span></strong><span>{PARAMETER_LABELS[proposal.parameter]}</span></div>
      <div className="proposal-actions"><Button className="proposal-accept" disabled={disabled || busy || snapshot.locked || !!snapshot.value.archivedAt} aria-label={`Принять замер: ${PARAMETER_LABELS[proposal.parameter]}, ${proposal.value} ${proposal.unit}`} onClick={() => { void accept(proposal); }}><Check size={18} aria-hidden /><span>Принять</span></Button>
        <Button className="proposal-dismiss" aria-label={`Отклонить замер: ${PARAMETER_LABELS[proposal.parameter]}, ${proposal.value}`} disabled={busy || disabled} onClick={() => hide(proposal.id)}><X size={18} aria-hidden /><span>Отклонить</span></Button></div>
      <p className="proposal-source">«{proposal.sourcePhrase}»{proposal.confidence === 'inferred' ? ' · Единица выбрана по параметру, проверьте её.' : ''}</p>
    </div>)}
    {status && <p role="status" aria-live="polite" className="proposal-caption">{status}</p>}{error && <p role="alert" className="field-error">{error}</p>}
  </section>;
}
