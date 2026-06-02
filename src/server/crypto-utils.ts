import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualString(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  const maxLength = Math.max(valueBuffer.length, expectedBuffer.length, 1);
  const paddedValue = Buffer.alloc(maxLength);
  const paddedExpected = Buffer.alloc(maxLength);

  valueBuffer.copy(paddedValue);
  expectedBuffer.copy(paddedExpected);

  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(paddedValue, paddedExpected)
  );
}
