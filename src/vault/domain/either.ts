export type Left<T> = [T, null];
export type Right<T> = [null, T];
export type Either<L, R> = Left<L> | Right<R>;

export const left = <L>(value: L): Left<L> => [value, null];
export const right = <R>(value: R): Right<R> => [null, value];
