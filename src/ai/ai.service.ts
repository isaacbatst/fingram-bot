import { Action } from '../domain/action';
import { Either } from '../domain/either';

export abstract class AiService {
  abstract parseVaultAction(input: string): Promise<Either<string, Action>>;
}
