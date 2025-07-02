export class ConcurrencyQueue<T, R> {
  private currentIndex = 0;
  private activeCount = 0;
  private results: (R | null)[];

  constructor(
    private items: T[],
    private concurrency: number,
    private processFn: (item: T, index: number) => Promise<R>,
  ) {
    this.results = new Array<R>(items.length);
  }

  run(): Promise<R[]> {
    return new Promise((resolve) => {
      const next = () => {
        if (this.currentIndex >= this.items.length) {
          if (this.activeCount === 0) {
            resolve(this.results.filter((r) => r !== null) as R[]);
          }
          return;
        }

        const index = this.currentIndex++;
        this.activeCount++;

        this.processFn(this.items[index], index)
          .then((result) => {
            this.results[index] = result;
          })
          .catch((err) => {
            console.error(
              `[ConcurrencyQueue] Error processing item ${index}:`,
              err,
            );
            this.results[index] = null; // ou outro valor padrão/tratamento
          })
          .finally(() => {
            this.activeCount--;
            next();
          });
      };

      // Inicializa o pool de concorrência
      for (let i = 0; i < this.concurrency && i < this.items.length; i++) {
        next();
      }
    });
  }
}
