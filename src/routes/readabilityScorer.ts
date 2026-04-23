import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { logger } from '../logger';

const router = Router();

const schema = Joi.object({
  text: Joi.string().min(50).max(50000).required(),
});

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function analyzeText(text: string) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const complexWords = words.filter(w => countSyllables(w) >= 3).length;

  const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
  const avgSyllablesPerWord = syllables / Math.max(words.length, 1);

  // Flesch Reading Ease
  const fleschEase = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  // Flesch-Kincaid Grade Level
  const gradeLevel = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;
  // Gunning Fog
  const gunningFog = 0.4 * (avgWordsPerSentence + (100 * complexWords / Math.max(words.length, 1)));

  const readingTimeMinutes = words.length / 200;

  let readingLevel = 'very_easy';
  if (fleschEase < 30) readingLevel = 'very_difficult';
  else if (fleschEase < 50) readingLevel = 'difficult';
  else if (fleschEase < 60) readingLevel = 'fairly_difficult';
  else if (fleschEase < 70) readingLevel = 'standard';
  else if (fleschEase < 80) readingLevel = 'fairly_easy';
  else if (fleschEase < 90) readingLevel = 'easy';

  return {
    flesch_reading_ease: Math.round(Math.max(0, Math.min(100, fleschEase)) * 10) / 10,
    flesch_kincaid_grade: Math.round(Math.max(0, gradeLevel) * 10) / 10,
    gunning_fog_index: Math.round(Math.max(0, gunningFog) * 10) / 10,
    reading_level: readingLevel,
    reading_time_minutes: Math.round(readingTimeMinutes * 10) / 10,
    word_count: words.length,
    sentence_count: sentences.length,
    avg_words_per_sentence: Math.round(avgWordsPerSentence * 10) / 10,
    avg_syllables_per_word: Math.round(avgSyllablesPerWord * 10) / 10,
    complex_word_count: complexWords,
    complex_word_percent: Math.round((complexWords / Math.max(words.length, 1)) * 1000) / 10,
  };
}

router.post('/readability', (req: Request, res: Response) => {
  const { error, value } = schema.validate(req.body);
  if (error) { res.status(400).json({ error: 'Validation failed', details: error.details[0].message }); return; }

  const start = Date.now();
  const result = analyzeText(value.text);
  logger.info({ reading_level: result.reading_level, word_count: result.word_count }, 'Readability scored');
  res.json({ ...result, latency_ms: Date.now() - start, timestamp: new Date().toISOString() });
});

export default router;
