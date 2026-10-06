export interface ItemInput {
  id: string;
  weight: number;
}

export interface LayoutRequest {
  name?: string;
  width: number;
  height: number;
  items: ItemInput[];
  tolerance?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ItemStatus = "placed" | "zero-weight";

export interface PlacedItem {
  id: string;
  weight: number;
  inputIndex: number;
  sortedIndex: number | null;
  status: ItemStatus;
  targetArea: number;
  rect: Rect | null;
}

export interface StripAttempt {
  candidateId: string;
  shortSide: number;
  worstBefore: number | null;
  worstAfter: number;
  decision: "accept" | "reject-seal";
  reason: string;
}

export interface StripRecord {
  index: number;
  orientation: "vertical" | "horizontal";
  x: number;
  y: number;
  thickness: number;
  length: number;
  itemIds: string[];
  attempts: StripAttempt[];
  sealedReason: string;
}

export interface LayoutResult {
  width: number;
  height: number;
  tolerance: number;
  items: PlacedItem[];
  strips: StripRecord[];
}

export interface VerifyIssue {
  kind:
    | "out-of-bounds"
    | "overlap"
    | "area-mismatch"
    | "total-area-mismatch"
    | "duplicate-item"
    | "missing-item";
  itemIds: string[];
  detail: string;
  deviation: number;
}

export interface VerifyReport {
  ok: boolean;
  tolerance: number;
  issues: VerifyIssue[];
  checkedItems: number;
  containerArea: number;
  placedArea: number;
}
