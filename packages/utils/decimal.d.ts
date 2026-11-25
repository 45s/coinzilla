export interface CompareDecimalOptions {
  readonly left: string | bigint;
  readonly right: string | bigint;
}

export declare function compareDecimal(options: CompareDecimalOptions): -1 | 0 | 1;
