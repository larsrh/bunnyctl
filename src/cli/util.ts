import { boolean, flag, option, optional, string } from "cmd-ts";
import { BunnyStorage } from "../storage.js";
import { BunnyRegion } from "../region.js";

export interface Config {
    apiKey?: string;
    storageZone?: string;
    region?: string;
}

export const configParser = {
    apiKey: option({
        type: optional(string),
        long: "api-key"
    }),
    storageZone: option({
        type: optional(string),
        long: "storage-zone"
    }),
    region: option({
        type: optional(string),
        long: "region"
    })
};

export const recursive = flag({
    type: boolean,
    long: "recursive",
    short: "r"
});

export function getStorage({
    apiKey,
    storageZone,
    region: rawRegion
}: Config): BunnyStorage {
    rawRegion = rawRegion || process.env.BUNNY_REGION;
    let region: BunnyRegion;
    if (rawRegion) {
        if (!(rawRegion in BunnyRegion))
            throw new Error(`Unknown region '${rawRegion}`);
        region = BunnyRegion[rawRegion as keyof typeof BunnyRegion];
    }
    return new BunnyStorage(
        apiKey || process.env.BUNNY_API_KEY,
        storageZone || process.env.BUNNY_STORAGE_ZONE,
        region
    );
}
