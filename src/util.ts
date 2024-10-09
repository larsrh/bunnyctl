import { pipe } from "fp-ts/function";
import { fold } from "fp-ts/Either";
import * as D from "io-ts/Decoder";

export function decode<T>(decoder: D.Decoder<unknown, T>, input: unknown): T {
    return pipe(
        decoder.decode(input),
        fold(
            errors => {
                throw new Error(D.draw(errors));
            },
            value => value
        )
    );
}

export const hexDecoder: D.Decoder<unknown, Uint8Array> = pipe(
    D.string,
    D.parse((hex: string) => {
        if (hex == "" || hex.length % 2 != 0)
            return D.failure(hex, "Malformed digest");
        const array = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            const item = parseInt(hex.slice(i, i + 2), 16)
            if (isNaN(item))
                return D.failure(hex, "Malformed digest");
            array[i / 2] = item;
        }
        return D.success(array);
    })
)

export function arrayToHex(array: Uint8Array): string {
    return Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hexToArray(hex: string): Uint8Array {
    return decode(hexDecoder, hex);
}

export interface ArrayLike<T> extends RelativeIndexable<T> {
    length: number;
}

export function arrayEquals<T>(expected: ArrayLike<T>, actual: ArrayLike<T>): boolean {
    if (expected.length != actual.length)
        return false;

    for (const i in actual)
        if (actual[i] != expected[i])
            return false;
    return true;
}

export function arrayDiff<T>(left: T[], right: T[]): { onlyLeft: T[], onlyRight: T[], both: T[] } {
    const leftSet = new Set(left);
    const rightSet = new Set(right);

    const onlyLeft: T[] = [];
    const both: T[] = [];

    for (const l of leftSet.values()) {
        if (rightSet.has(l)) {
            both.push(l);
            rightSet.delete(l);
        }
        else {
            onlyLeft.push(l);
        }
    }

    const onlyRight = [...rightSet.values()];
    return { onlyLeft, onlyRight, both };
}

export function coalesce<T>(array: (T | undefined)[]): T[] {
    return array.filter(t => t);
}