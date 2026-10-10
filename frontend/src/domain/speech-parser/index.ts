import { readRussianNumber, parseRussianNumber } from './number-words.js';
import { MEASUREMENT_PATTERNS, speechUnit, type MeasurementPattern } from './measurement-patterns.js';
import type { NormParameter } from '../norms/types.js';
export interface FieldProposal {
  readonly id: string; readonly parameter: NormParameter; readonly value: number;
  readonly unit: 'mm' | 'cm' | 'm' | '%' | 'deg'; readonly sourcePhrase: string;
  readonly confidence: 'exact' | 'inferred';
}
const TRIGGERS = MEASUREMENT_PATTERNS.flatMap(pattern => pattern.triggers.map(phrase => ({pattern,words:phrase.split(' ')})));
interface Token { word: string; start: number; end: number; }
/** Pure, bounded and deterministic. IDs encode the source span and value, not random UUIDs. */
export function extractMeasurementProposals(transcript: string, elementType: string): FieldProposal[] {
  if (!MEASUREMENT_PATTERNS.some(p => p.elementType === elementType)) return [];
  const proposals: FieldProposal[] = [];
  // Newlines and punctuation delimit facts; decimal punctuation stays inside numbers.
  const clauses = transcript.matchAll(/[^;!?\n]+/gu);
  for (const clause of clauses) {
    const base = clause.index; const original = clause[0];
    const tokens: Token[] = [...original.matchAll(/\d+(?:[.,]\d+)?|[а-яё]+|[%°]|[.,:–—-]/giu)].map(m => ({word:m[0].toLocaleLowerCase('ru-RU').replaceAll('ё','е'),start:base+m.index,end:base+m.index+m[0].length}));
    const words = tokens.map(token => token.word);
    let trigger: { pattern: MeasurementPattern; start: number; hintedUnit?: 'deg' } | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (['.',',',':','–','—','-'].includes(token.word)) { if (token.word !== ':') trigger = undefined; continue; }
      const candidates = TRIGGERS
        .filter(candidate => candidate.words.every((word,k) => tokens[i+k]?.word === word))
        .sort((a,b) => b.words.length-a.words.length || Number(b.pattern.elementType === elementType)-Number(a.pattern.elementType === elementType));
      const candidate = candidates[0];
      if (candidate) { trigger = {pattern:candidate.pattern,start:i,...(candidate.words[0]?.startsWith('градус') ? {hintedUnit:'deg' as const} : {})}; i += candidate.words.length-1; continue; }
      if (['высота','длина','номер'].includes(token.word)) { trigger=undefined; continue; }
      const number = readRussianNumber(words,i);
      if (!number) { if (parseRussianNumber(token.word) !== undefined) trigger = undefined; continue; }
      const unit = speechUnit(tokens[number.end]?.word);
      let current = trigger;
      if (!current && elementType === 'ramp' && (unit === '%' || unit === 'deg')) current = {pattern:MEASUREMENT_PATTERNS.find(p=>p.parameter==='rampSlope')!,start:i};
      if (!current || current.pattern.elementType !== elementType) { i = number.end-1; trigger=undefined; continue; }
      const end = number.end + (unit ? 1 : 0);
      const surrounding = tokens.slice(Math.max(0,current.start-5), Math.min(tokens.length,end+3)).map(t=>t.word);
      // Negative facts, ranges, alternatives and intended changes must not become measured facts.
      const unsafe = surrounding.some(word => ['не','нет','без','от','до','или','примерно','около','минус','увеличить','уменьшить','сделать','нужно','надо','рекомендуется','должна','должен','должно','должны','необходимо','следует','рекомендую','рекомендуем'].includes(word))
        || tokens[i-1]?.word === '-' || tokens[end]?.word === '-' || tokens[end]?.word === '–';
      const actualUnit = unit ?? current.hintedUnit ?? current.pattern.defaultUnit;
      const compatible = current.pattern.parameter === 'rampSlope' ? ['%','deg'].includes(actualUnit) : ['mm','cm','m'].includes(actualUnit);
      if (!unsafe && compatible && !(actualUnit === 'deg' && number.value >= 90)) {
        const start = tokens[current.start]!.start; const finish = tokens[end-1]!.end;
        proposals.push({id:`speech:${start}:${finish}:${current.pattern.parameter}:${number.value}:${actualUnit}`,parameter:current.pattern.parameter,value:number.value,unit:actualUnit,sourcePhrase:transcript.slice(start,finish),confidence:unit || current.hintedUnit ? 'exact' : 'inferred'});
      }
      i = end-1; trigger = undefined;
    }
  }
  return proposals;
}
