import fc from "fast-check";

const items = "0123456789abcdef";

function hexa(): fc.Arbitrary<string> {
    return fc.integer({ min: 0, max: 15 }).map(n => items[n]);
}

export function hexaString(
    constraints: fc.StringConstraints = {}
): fc.Arbitrary<string> {
    return fc.string({ ...constraints, unit: hexa() });
}
