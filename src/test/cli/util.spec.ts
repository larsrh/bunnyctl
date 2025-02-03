import assert from "assert";
import fc from "fast-check";
import { parseTypedPath } from "../../cli/util.js";

describe("Path parsing", () => {
    it("parse local path", () => {
        fc.assert(
            fc.property(fc.string(), string => {
                const typed = `local:${string}`;
                assert.deepEqual(parseTypedPath(typed), ["local", string]);
            })
        );
    });
    it("parse remote path", () => {
        fc.assert(
            fc.property(fc.string(), string => {
                const typed = `remote:${string}`;
                assert.deepEqual(parseTypedPath(typed), ["remote", string]);
            })
        );
    });
    it("parse unqualified path", () => {
        fc.assert(
            fc.property(fc.string(), string => {
                fc.pre(!string.includes(":"));
                assert.deepEqual(parseTypedPath(string), [undefined, string]);
            })
        );
    });
});
