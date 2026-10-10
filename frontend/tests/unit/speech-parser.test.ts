import { describe, expect, it } from 'vitest';
import { parseRussianNumber } from '../../src/domain/speech-parser/number-words.js';
import { extractMeasurementProposals as extract } from '../../src/domain/speech-parser/index.js';
describe('Russian number expressions', () => {
  it.each([
    ['ноль',0],['одна',1],['две',2],['девятнадцать',19],['восемьдесят пять',85],
    ['сто двадцать три',123],['девятьсот девяносто девять',999],['85',85],['0',0],['2,05',2.05],
    ['полтора',1.5],['полторы',1.5],['две целых пять сотых',2.05],['ноль целых пять десятых',.5],
    ['одна целая одна сотая',1.01],['пять сотых',.05],['четыре с половиной',4.5],['4 с половиной',4.5],
  ])('%s = %s', (text,value) => expect(parseRussianNumber(String(text))).toBe(value));
  it.each(['','сто сто','двадцать десять','1000','минус два','-2','Infinity','NaN','constructor','две целых пятнадцать десятых','1e3','три сантиметра'])('rejects incomplete/invalid expression %s', text => expect(parseRussianNumber(text)).toBeUndefined());
});
describe('Local Z2 field proposals', () => {
  it.each([
    ['ширина восемьдесят пять сантиметров','door','doorWidth',85,'cm','exact'],
    ['порог 2 см','door','thresholdHeight',2,'cm','exact'],
    ['дверь 90','door','doorWidth',90,'cm','inferred'],
    ['уклон 4 с половиной процента','ramp','rampSlope',4.5,'%','exact'],
    ['ширина проёма 0,85 м','door','doorWidth',.85,'m','exact'],
    ['ширина полотна девятьсот миллиметров','door','doorWidth',900,'mm','exact'],
    ['перепад две целых пять сотых сантиметра','door','thresholdHeight',2.05,'cm','exact'],
    ['порог ноль','door','thresholdHeight',0,'cm','inferred'],
    ['ширина марша 90 см','ramp','rampWidth',90,'cm','exact'],
    ['проход полтора метра','ramp','rampWidth',1.5,'m','exact'],
    ['уклон 5','ramp','rampSlope',5,'%','inferred'],
    ['градус 4','ramp','rampSlope',4,'deg','exact'],
    ['4 градуса','ramp','rampSlope',4,'deg','exact'],
    ['процент уклона пять процентов','ramp','rampSlope',5,'%','exact'],
    ['глубина площадки 150 см','platform','landingDepth',150,'cm','exact'],
  ])('%s resolves within %s', (text,type,parameter,value,unit,confidence) => {
    const result = extract(String(text),String(type)); expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({parameter,value,unit,confidence,sourcePhrase:text});
  });
  it('retains exact source substring, case and decimal punctuation', () => {
    const result = extract('Осмотр. Ширина проёма: 85,5 см, порог 2 см.','door');
    expect(result.map(p=>p.parameter)).toEqual(['doorWidth','thresholdHeight']);
    expect(result[0]?.sourcePhrase).toBe('Ширина проёма: 85,5 см');
  });
  it('returns separate explicit facts and alternatives for user choice', () => {
    const result = extract('ширина 85 см; ширина 90 см; порог 1,4 см','door');
    expect(result.map(p=>p.value)).toEqual([85,90,1.4]); expect(new Set(result.map(p=>p.id)).size).toBe(3);
  });
  it.each([
    ['ширина пандуса 90 см','door'],['порог 2 см','ramp'],['уклон 5 процентов','door'],
    ['глубина площадки 150 см','door'],['ширина 90 см','handrail'],['ширина 90 см','unknown'],
    ['ширина 85 процентов','door'],['уклон 5 см','ramp'],['уклон 90 градусов','ramp'],
    ['не ширина 85 см','door'],['ширина не 85 см','door'],['порог отсутствует','door'],
    ['нужно увеличить ширина 90 см','door'],['ширина от 85 до 90 см','door'],['ширина 85–90 см','door'],
    ['ширина минус два см','door'],['ширина -2 см','door'],['ширина примерно 85 см','door'],
    ['ширина две целых пятнадцать десятых см','door'],['номер объекта 85','door'],
    ['ширина высота 85 см','door'],['ширина 1000 см','door'],['','door'],
  ])('does not propose unsafe/wrong-context input %s', (text,type) => expect(extract(text,type)).toEqual([]));
  it('does not consume unrelated following numbers as measurements', () => {
    expect(extract('ширина 85 см, кабинет 90, телефон 123','door').map(p=>p.value)).toEqual([85]);
  });
  it('uses stable IDs and does not depend on clocks, UUIDs, network or locale state', () => {
    expect(extract('порог 2 см','door')).toEqual(extract('порог 2 см','door'));
  });
});
