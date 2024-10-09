import fc from "fast-check";
import { assert } from "chai";
import { arrayToHex, hexToArray } from "../util.js";
import { hexaString } from "./util.js";

describe("Hex to Array", () => {
    it("arrayToHex -> hexToArray", () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 2 }), data => {
                fc.pre(data.length % 2 == 0);
                assert.deepEqual(hexToArray(arrayToHex(data)), data);
            })
        );
    });
    it("hexToArray -> arrayToHex", () => {
        fc.assert(
            fc.property(hexaString({ minLength: 2 }), string => {
                fc.pre(string.length % 2 == 0);
                assert.equal(arrayToHex(hexToArray(string)), string);
            })
        );
    });
});
