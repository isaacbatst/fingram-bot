import { Action } from '../domain/action';
import { Category } from '../domain/category';
import { Either } from '../domain/either';

export abstract class AiService {
  abstract parseVaultAction(
    input: string,
    categories: Category[],
  ): Promise<Either<string, Action>>;
}
