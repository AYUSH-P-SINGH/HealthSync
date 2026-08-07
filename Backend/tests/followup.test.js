/**
 * Follow-up extractor + state machine tests.
 *
 * These are pure-function tests — no database, no network — so they run fast
 * and are safe to keep in CI. The extractor is the component most likely to
 * regress silently, because a regex tweak that helps one report shape can
 * quietly break another, and nothing in the UI would tell you.
 *
 * The false-positive cases matter as much as the true-positive ones. A system
 * that invents follow-ups trains clinicians to ignore it, and an ignored
 * safety net is worse than no safety net.
 */
const { extract } = require('../src/services/extractors/rulesExtractor');
const { validateAndMap, _internals: llmInternals } = require('../src/services/extractors/llmExtractor');
const { CONFIDENCE, ALLOWED_TRANSITIONS, LIMITS } = require('../src/constants/followUp');

const ANCHOR = new Date('2026-02-14T00:00:00Z');
const run = (text) => extract(text, { anchorDate: ANCHOR }).candidates;
const daysFrom = (d) => Math.round((new Date(d) - ANCHOR) / 86_400_000);

describe('rulesExtractor — true positives', () => {
  test('extracts a classic incidental pulmonary nodule recommendation', () => {
    const [c] = run(
      'IMPRESSION: Incidental 6 mm pulmonary nodule, right lower lobe. ' +
        'Recommend interval follow-up chest CT in 6 months to assess stability.'
    );
    expect(c).toBeDefined();
    expect(c.category).toBe('imaging');
    expect(c.action).toMatch(/CT/i);
    expect(c.finding).toContain('6 mm');
    expect(daysFrom(c.dueAt)).toBe(180);
    expect(c.confidence).toBeGreaterThanOrEqual(CONFIDENCE.AUTO_OPEN);
  });

  test('resolves a range to its EARLIER bound', () => {
    // A reminder at the end of a window arrives after the chance to act on it.
    const [c] = run('Recommend repeat ultrasound in 3 to 6 months for the 1.2 cm renal cyst.');
    expect(daysFrom(c.dueAt)).toBe(90);
  });

  test('handles hyphenated ranges', () => {
    const [c] = run('Suggest repeat CT in 3-6 months for the indeterminate nodule.');
    expect(daysFrom(c.dueAt)).toBe(90);
  });

  test('rejoins a recommendation split across a PDF line break', () => {
    const [c] = run('IMPRESSION: 4 mm nodule. Recommend interval CT in 12\nmonths.');
    expect(c).toBeDefined();
    expect(daysFrom(c.dueAt)).toBe(360);
  });

  test('parses spelled-out intervals', () => {
    const [c] = run('A follow-up mammogram is recommended in six months.');
    expect(daysFrom(c.dueAt)).toBe(180);
  });

  test('picks the abnormal lab value as the finding, not the interval number', () => {
    const [c] = run('HbA1c is elevated at 8.1%. Advise repeat HbA1c in 3 months.');
    expect(c.category).toBe('lab');
    expect(c.finding).toContain('8.1');
    expect(c.finding).not.toMatch(/at 3$/);
  });

  test('escalates severity from explicit clinical language', () => {
    const [c] = run(
      'There is a highly suspicious 2.4 cm hepatic lesion. Urgent oncology referral and biopsy is recommended.'
    );
    expect(c.severity).toBe('critical');
    expect(daysFrom(c.dueAt)).toBeLessThanOrEqual(7);
  });

  test('treats a very short interval as urgent even without urgent wording', () => {
    const [c] = run('Serum creatinine raised at 1.9. Repeat renal function tests in 1 week.');
    expect(c.severity).toBe('urgent');
  });

  test('keeps a recommendation with no stated deadline, but requires confirmation', () => {
    // Dropping this entirely is the exact failure the feature exists to fix.
    const [c] = run('Recommend cardiology referral for the newly noted murmur.');
    expect(c).toBeDefined();
    expect(c.category).toBe('consult');
    expect(c.inferredWindow).toBe(true);
    expect(c.confidence).toBeGreaterThanOrEqual(CONFIDENCE.MIN_SUGGEST);
    expect(c.confidence).toBeLessThan(CONFIDENCE.AUTO_OPEN);
  });

  test('always preserves the verbatim source sentence', () => {
    const sentence = 'Recommend interval follow-up chest CT in 6 months.';
    const [c] = run(`Incidental 6 mm nodule. ${sentence}`);
    expect(c.sourceText).toContain('interval follow-up chest CT');
  });
});

describe('rulesExtractor — false positives it must reject', () => {
  const mustBeEmpty = [
    ['negated follow-up', 'The study is unremarkable. No further follow-up imaging is recommended.'],
    ['not indicated', 'Routine repeat imaging is not indicated at this time.'],
    ['already performed', 'A follow-up MRI was performed on 12 March and showed no change.'],
    ['already completed', 'The recommended colonoscopy has been completed.'],
    ['hedged/conditional', 'Mild thyroid enlargement. Ultrasound may be considered if clinically indicated.'],
    ['report boilerplate', 'Results were discussed with the referring physician. Thank you for the referral.'],
    ['normal study', 'Chest X-ray is normal. Heart size within normal limits.'],
    ['empty input', ''],
    ['whitespace only', '     \n\n   '],
  ];

  test.each(mustBeEmpty)('rejects: %s', (_name, text) => {
    expect(run(text)).toHaveLength(0);
  });

  test('does not double-count a recommendation restated in two sections', () => {
    const out = run(
      'FINDINGS: 5 mm nodule. Recommend follow-up CT in 6 months.\n' +
        'IMPRESSION: 5 mm nodule. Recommend follow-up CT in 6 months.'
    );
    expect(out).toHaveLength(1);
  });
});

describe('rulesExtractor — bounds and hostile input', () => {
  test('caps the number of obligations from one report', () => {
    const one = 'Recommend repeat CT in 6 months. ';
    const out = run(one.repeat(50));
    expect(out.length).toBeLessThanOrEqual(LIMITS.MAX_PER_RECORD);
  });

  test('keeps a recommendation with an unparseable interval, but refuses to auto-open it', () => {
    // "in 600 months" is an OCR artifact, not a care plan. Dropping the whole
    // recommendation would lose a real finding; silently substituting a
    // default deadline would invent a date the report never gave. Neither is
    // acceptable, so it goes to the patient to correct.
    const [c] = run('Recommend repeat scan in 600 months.');
    expect(c).toBeDefined();
    expect(c.unparseableTimeframe).toBe(true);
    expect(c.inferredWindow).toBe(true);
    expect(c.confidence).toBeLessThan(CONFIDENCE.AUTO_OPEN);
  });

  test('a plausible long interval is still accepted', () => {
    const [c] = run('A 9 mm sigmoid polyp was removed. Repeat colonoscopy is recommended in 3 years.');
    expect(c.unparseableTimeframe).toBe(false);
    expect(daysFrom(c.dueAt)).toBe(1095);
  });

  test('never reports full certainty', () => {
    const [c] = run(
      'Incidental 6 mm pulmonary nodule. Recommend interval follow-up chest CT in 6 months.'
    );
    expect(c.confidence).toBeLessThanOrEqual(0.95);
  });

  test('runs in linear time on pathological input (ReDoS guard)', () => {
    const evil = `Recommend ${'a'.repeat(20000)} follow-up in 6 months ${'1.'.repeat(5000)}`;
    const started = Date.now();
    extract(evil, { anchorDate: ANCHOR });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('truncates input beyond the configured ceiling', () => {
    const huge = `${'filler sentence here. '.repeat(20000)}Recommend repeat CT in 6 months.`;
    expect(huge.length).toBeGreaterThan(LIMITS.MAX_TEXT_CHARS);
    expect(() => extract(huge, { anchorDate: ANCHOR })).not.toThrow();
  });

  test('tolerates non-string input without throwing', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => extract(bad, { anchorDate: ANCHOR })).not.toThrow();
    }
  });
});

describe('llmExtractor — hallucination grounding', () => {
  const report = 'Incidental 6 mm pulmonary nodule. Recommend interval chest CT in 6 months.';

  test('accepts an item whose sourceText really appears in the report', () => {
    const out = validateAndMap(
      [{
        finding: '6 mm pulmonary nodule',
        action: 'Repeat CT scan',
        category: 'imaging',
        severity: 'routine',
        dueInDays: 180,
        sourceText: 'Recommend interval chest CT in 6 months.',
        confidence: 0.9,
      }],
      { anchorDate: ANCHOR, sourceText: report, model: 'test' }
    );
    expect(out).toHaveLength(1);
    expect(out[0].extractedBy).toBe('llm:test');
  });

  test('DROPS an item whose sourceText was invented', () => {
    const out = validateAndMap(
      [{
        finding: 'aortic aneurysm',
        action: 'Urgent surgical review',
        category: 'consult',
        severity: 'critical',
        dueInDays: 3,
        sourceText: 'Recommend immediate vascular surgery consultation.', // not in report
        confidence: 0.99,
      }],
      { anchorDate: ANCHOR, sourceText: report, model: 'test' }
    );
    expect(out).toHaveLength(0);
  });

  test('caps self-reported confidence below the blind-trust ceiling', () => {
    const out = validateAndMap(
      [{
        finding: '6 mm pulmonary nodule',
        action: 'Repeat CT scan',
        category: 'imaging',
        severity: 'routine',
        dueInDays: 180,
        sourceText: 'Recommend interval chest CT in 6 months.',
        confidence: 1.0,
      }],
      { anchorDate: ANCHOR, sourceText: report, model: 'test' }
    );
    expect(out[0].confidence).toBeLessThanOrEqual(0.95);
  });

  test('rejects out-of-range due windows and malformed items', () => {
    const out = validateAndMap(
      [
        { finding: 'x', action: 'y', dueInDays: 99999, sourceText: report, confidence: 0.9 },
        { finding: '', action: 'y', dueInDays: 30, sourceText: report, confidence: 0.9 },
        null,
        'not an object',
      ],
      { anchorDate: ANCHOR, sourceText: report, model: 'test' }
    );
    expect(out).toHaveLength(0);
  });

  test('grounding check ignores whitespace and case differences only', () => {
    expect(llmInternals.isGrounded('RECOMMEND   interval chest CT in 6 months.', report)).toBe(true);
    expect(llmInternals.isGrounded('recommend interval brain MRI in 6 months.', report)).toBe(false);
  });
});

describe('lifecycle state machine', () => {
  test('a low-confidence extraction cannot skip patient confirmation', () => {
    expect(ALLOWED_TRANSITIONS.pending_confirm).toContain('open');
    expect(ALLOWED_TRANSITIONS.pending_confirm).not.toContain('completed');
    expect(ALLOWED_TRANSITIONS.pending_confirm).not.toContain('scheduled');
  });

  test('resolved obligations are terminal — nothing can resurrect them', () => {
    expect(ALLOWED_TRANSITIONS.completed).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.dismissed).toHaveLength(0);
  });

  test('an overdue obligation can still be resolved', () => {
    expect(ALLOWED_TRANSITIONS.overdue).toEqual(
      expect.arrayContaining(['scheduled', 'completed', 'dismissed'])
    );
  });
});
