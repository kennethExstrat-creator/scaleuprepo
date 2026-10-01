"use client";

import { useState } from "react";

/**
 * `value`, or the last non-null value while `value` is null: a dialog keeps its title and content
 * during its closing animation after its state was cleared.
 */
export function useRetained<T>(value: T | null): T | null {
  const [retained, setRetained] = useState<T | null>(value);
  if (value !== null && value !== retained) setRetained(value);
  return value ?? retained;
}
