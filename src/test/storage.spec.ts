import * as path from "node:path";
import nock from "nock";
import { getStorage } from "../cli/util.js";
import * as chai from "chai";
import { bunnyFileEntry } from "../storage.js";
import { arrayToHex } from "../util.js";
import chaiAsPromised from "chai-as-promised";
import { uploadPath } from "../storage-algorithms.js";

const { assert } = chai;

chai.use(chaiAsPromised);

const nockBack = nock.back;

const update = process.env.BUNNYCTL_TEST_MODE == "update";

const storage = getStorage({
    apiKey: process.env.BUNNY_API_KEY || "dummy",
    storageZone: "lars-test"
});

describe("Storage", () => {
    before(async () => {
        if (!update) return;
        console.log("Preparing storage zone ...");
        const fixtures = path.join(process.cwd(), "fixtures");
        const storage = getStorage({});
        await storage
            .cd("/test/")
            .delete(true)
            .catch(() => {});
        await uploadPath(storage, fixtures, "/", { recursive: true });
        console.log("Finished storage zone");
    });

    beforeEach(() => {
        nockBack.setMode(update ? "update" : "lockdown");
        nockBack.fixtures = path.join(import.meta.dirname, "fixtures");
    });

    afterEach(() => {
        nock.cleanAll();
    });

    it("Describe existing file", async () => {
        const { nockDone } = await nockBack("describe-existing.json");

        const entry = await storage.describe("/test/test1.txt");
        assert.equal(entry.type, bunnyFileEntry);
        assert.equal(entry.length, 12);
        assert.equal(
            arrayToHex(entry.checksum),
            "64255a508753b2c76358ef4052aff12e671b5c3ba1f1a7fcfa5fe751d6e29083"
        );

        nockDone();
    });

    it("Describe non-existing file", async () => {
        const { nockDone } = await nockBack("describe-non-existing.json");

        await assert.eventually.isUndefined(
            storage.maybeDescribe("/test/test1.nope.txt")
        );

        nockDone();
    });

    it("Describe non-existing file (throwing)", async () => {
        const { nockDone } = await nockBack("describe-non-existing.json");

        await assert.isRejected(storage.describe("/test/test1.nope.txt"));

        nockDone();
    });

    it("Delete file", async () => {
        const { nockDone } = await nockBack("delete.json");

        await assert.isFulfilled(storage.delete("/test/test2.txt"));

        nockDone();
    });
});
