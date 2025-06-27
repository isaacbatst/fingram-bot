import csv from 'csv-parser';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

export class CsvParser {
  static parse(file: ReadableStream): Promise<string[][]> {
    const results: string[][] = [];
    const readable = Readable.fromWeb(file);
    return new Promise((resolve, reject) => {
      readable
        .pipe(csv())
        .on('data', (data) => {
          results.push(Object.values(data));
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(new Error(`Error parsing CSV: ${error.message}`));
        });
    });
  }
}
