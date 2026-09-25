import { describe, it, expect } from 'vitest';
import {
  Category,
  nextCategoryCode,
  normalizeCategoryName,
  validateCategoryName,
} from './category';

const cat = (code: string, name = `Cat ${code}`) =>
  new Category(`id-${code}`, name, code);

describe('nextCategoryCode', () => {
  it('follows the highest numeric code', () => {
    expect(nextCategoryCode([cat('1'), cat('12'), cat('3')])).toBe('13');
  });

  it('ignores non-numeric codes and starts at 1', () => {
    expect(nextCategoryCode([])).toBe('1');
    expect(nextCategoryCode([cat('abc'), cat('2')])).toBe('3');
  });
});

describe('normalizeCategoryName', () => {
  it('ignores case, accents, emoji and punctuation', () => {
    expect(normalizeCategoryName('🏥 Saúde')).toBe('saude');
    expect(normalizeCategoryName('  SAUDE ')).toBe('saude');
    expect(normalizeCategoryName('👪 Família & Pets')).toBe('familia pets');
  });
});

describe('validateCategoryName', () => {
  const existing = [cat('5', '🏥 Saúde')];

  it('accepts a new name', () => {
    expect(validateCategoryName('Pets', existing)).toBeNull();
  });

  it('rejects empty and too long names', () => {
    expect(validateCategoryName('', existing)).toMatch(/vazio/);
    expect(validateCategoryName('x'.repeat(41), existing)).toMatch(/40/);
  });

  it('rejects a name that matches an existing category', () => {
    expect(validateCategoryName('saude', existing)).toBe(
      'Já existe a categoria "🏥 Saúde"',
    );
  });
});
