const units: Readonly<Record<string, number>> = { ноль:0, нуль:0, один:1, одна:1, одно:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6, семь:7, восемь:8, девять:9 };
const teens: Readonly<Record<string, number>> = { десять:10, одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14, пятнадцать:15, шестнадцать:16, семнадцать:17, восемнадцать:18, девятнадцать:19 };
const tens: Readonly<Record<string, number>> = { двадцать:20, тридцать:30, сорок:40, пятьдесят:50, шестьдесят:60, семьдесят:70, восемьдесят:80, девяносто:90 };
const hundreds: Readonly<Record<string, number>> = { сто:100, двести:200, триста:300, четыреста:400, пятьсот:500, шестьсот:600, семьсот:700, восемьсот:800, девятьсот:900 };
function integer(words: readonly string[]): number | undefined {
  if (words.length === 1 && /^\d+$/.test(words[0]!)) { const n = Number(words[0]); return n <= 999 ? n : undefined; }
  let i = 0, value = 0;
  if (typeof hundreds[words[i]!] === 'number') value += hundreds[words[i++]!]!;
  if (typeof teens[words[i]!] === 'number') value += teens[words[i++]!]!;
  else if (typeof tens[words[i]!] === 'number') { value += tens[words[i++]!]!; if (typeof units[words[i]!] === 'number' && units[words[i]!]! > 0) value += units[words[i++]!]!; }
  else if (typeof units[words[i]!] === 'number' && (i === 0 || units[words[i]!]! > 0)) value += units[words[i++]!]!;
  return i > 0 && i === words.length ? value : undefined;
}
/** Parses a complete number expression, not arbitrary prose. */
export function parseRussianNumber(text: string): number | undefined {
  const normalized = text.toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim();
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) { const n = Number(normalized.replace(',','.')); return Number.isFinite(n) && n < 1000 ? n : undefined; }
  const words = normalized.split(/\s+/);
  if (words.length === 1 && ['полтора','полторы'].includes(words[0]!)) return 1.5;
  const half = normalized.match(/^(.+) с половиной$/);
  if (half) { const whole = integer(half[1]!.split(/\s+/)); return whole !== undefined ? whole + .5 : undefined; }
  const divider = words.findIndex(word => ['целая','целое','целых'].includes(word));
  if (divider >= 0) {
    const whole = integer(words.slice(0,divider)); const last = words.at(-1);
    const denominator = last && /^(десятая|десятых|десятые)$/.test(last) ? 10 : last && /^(сотая|сотых|сотые)$/.test(last) ? 100 : undefined;
    const numerator = integer(words.slice(divider+1,-1));
    return whole !== undefined && numerator !== undefined && denominator && numerator < denominator ? whole + numerator / denominator : undefined;
  }
  const last = words.at(-1);
  const denominator = last && /^(десятая|десятых|десятые)$/.test(last) ? 10 : last && /^(сотая|сотых|сотые)$/.test(last) ? 100 : undefined;
  if (denominator) { const n = integer(words.slice(0,-1)); return n !== undefined && n < denominator ? n / denominator : undefined; }
  return integer(words);
}
export function readRussianNumber(words: readonly string[], start: number): { value: number; end: number } | undefined {
  let result: { value: number; end: number } | undefined;
  for (let end = start+1; end <= Math.min(words.length,start+12); end++) {
    const value = parseRussianNumber(words.slice(start,end).join(' '));
    if (value !== undefined) result = { value, end };
  }
  if (result && ['целая','целое','целых','с','десятая','десятых','десятые','сотая','сотых','сотые'].includes(words[result.end] ?? '')) return undefined;
  return result;
}
