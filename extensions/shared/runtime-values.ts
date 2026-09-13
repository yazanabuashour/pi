import { Type } from "typebox";
import { Value } from "typebox/value";

const booleanSchema = Type.Boolean();
const functionSchema = Type.Function([], Type.Any());
const numberSchema = Type.Number();
const recordSchema = Type.Record(Type.String(), Type.Any());
const stringSchema = Type.String();

export interface RuntimeRecord {
  [key: string]: RuntimeValue;
}

export type RuntimeValue =
  | bigint
  | boolean
  | null
  | number
  | RuntimeRecord
  | readonly RuntimeValue[]
  | string
  | symbol
  | undefined;

export function isBoolean(value: RuntimeValue): value is boolean;
export function isBoolean<ValueType>(
  value: ValueType,
): value is ValueType & boolean;
export function isBoolean<ValueType>(
  value: ValueType,
): value is ValueType & boolean {
  return Value.Check(booleanSchema, value);
}

export function isBigInt<ValueType>(
  value: ValueType,
): value is ValueType & bigint {
  return Object.prototype.toString.call(value) === "[object BigInt]";
}

export function isFunction<ValueType>(
  value: ValueType,
): value is ValueType & ((...args: never[]) => RuntimeValue) {
  return Value.Check(functionSchema, value);
}

export function isNumber(value: RuntimeValue): value is number;
export function isNumber<ValueType>(
  value: ValueType,
): value is ValueType & number;
export function isNumber<ValueType>(
  value: ValueType,
): value is ValueType & number {
  return Value.Check(numberSchema, value);
}

export function isObjectValue<ValueType>(
  value: ValueType,
): value is ValueType & (RuntimeRecord | readonly RuntimeValue[] | null) {
  return value === null || (Object(value) === value && !isFunction(value));
}

export function isRuntimeRecord<ValueType>(
  value: ValueType,
): value is ValueType & RuntimeRecord {
  return Value.Check(recordSchema, value);
}

export function isString(value: RuntimeValue): value is string;
export function isString<ValueType>(
  value: ValueType,
): value is ValueType & string;
export function isString<ValueType>(
  value: ValueType,
): value is ValueType & string {
  return Value.Check(stringSchema, value);
}

export function isSymbol<ValueType>(
  value: ValueType,
): value is ValueType & symbol {
  return Object.prototype.toString.call(value) === "[object Symbol]";
}
