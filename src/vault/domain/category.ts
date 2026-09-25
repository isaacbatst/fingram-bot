export type CategoryTransactionType = 'income' | 'expense' | 'both';

export class Category {
  constructor(
    readonly id: string,
    public name: string,
    readonly code: string,
    public description: string = '',
    public transactionType: CategoryTransactionType = 'expense',
  ) {}
}

/**
 * Codes are the numeric strings the Telegram commands take (/setbudget,
 * /edit -c). A new category gets the next number after the highest one.
 */
export function nextCategoryCode(categories: Category[]): string {
  const highest = categories.reduce((max, c) => {
    const n = Number(c.code);
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  return String(highest + 1);
}

/**
 * Ignores case, accents, emoji and punctuation, so "saude" and the base
 * category "🏥 Saúde" are the same name.
 */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export const CATEGORY_NAME_MAX_LENGTH = 40;

/** Returns an error message, or null when `name` (already trimmed) is valid. */
export function validateCategoryName(
  name: string,
  otherCategories: Category[],
): string | null {
  if (!name) return 'O nome da categoria não pode ser vazio';
  if (name.length > CATEGORY_NAME_MAX_LENGTH)
    return `O nome da categoria deve ter até ${CATEGORY_NAME_MAX_LENGTH} caracteres`;
  const normalized = normalizeCategoryName(name);
  const clash = otherCategories.find(
    (c) => normalizeCategoryName(c.name) === normalized,
  );
  if (clash) return `Já existe a categoria "${clash.name}"`;
  return null;
}
