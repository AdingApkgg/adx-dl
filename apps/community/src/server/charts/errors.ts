import type { ChartImportErrorCode } from "../../shared/charts";

/** Safe, stable import rejection. Never attach source contents or upstream error text. */
export class ChartImportError extends Error {
  constructor(public readonly code: ChartImportErrorCode) { super(code); this.name = "ChartImportError"; }
}
