#!/usr/bin/env node
import {
    command,
    option,
    run,
    string,
    positional,
    subcommands,
    optional,
    boolean,
    flag
} from "cmd-ts";
import { type BunnyListing, BunnyStorage } from "./storage.js";
import { BunnyRegion } from "./region.js";
import { hexToArray } from "./util.js";
import * as Algorithms from "./storage-algorithms.js";

interface Config {
    apiKey?: string;
    storageZone?: string;
    region?: string;
}

const configParser = {
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

function getStorage({
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

const ls = command({
    name: "ls",
    args: {
        path: positional({
            type: string,
            displayName: "PATH"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        let listing: BunnyListing;
        if (args.path.endsWith("/")) listing = await storage.list(args.path);
        else listing = [await storage.describe(args.path)];
        listing.forEach(entry => console.log(entry.format()));
    }
});

const cat = command({
    name: "cat",
    args: {
        path: positional({
            type: string,
            displayName: "PATH"
        }),
        checksum: option({
            type: optional(string),
            long: "checksum"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        let checksum: Uint8Array;
        if (args.checksum) checksum = hexToArray(args.checksum);
        const buffer = await storage.download(args.path, checksum);
        process.stdout.write(buffer);
    }
});

const diff = command({
    name: "diff",
    args: {
        localPath: positional({
            type: string,
            displayName: "LOCAL-PATH"
        }),
        remotePath: positional({
            type: string,
            displayName: "REMOTE-PATH"
        }),
        recursive: flag({
            type: boolean,
            long: "recursive",
            short: "r"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        const entry = await Algorithms.loadPath(storage, args.remotePath);
        const differences = await Algorithms.diffPaths(
            args.localPath,
            entry,
            args.recursive
        );
        if (differences)
            console.log(differences.format(d => d.format()).join("\n"));
        else console.log("Paths identical");
    }
});

const rm = command({
    name: "rm",
    args: {
        path: positional({
            type: string,
            displayName: "PATH"
        }),
        recursive: flag({
            type: boolean,
            long: "recursive",
            short: "r"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        const entry = await Algorithms.loadPath(storage, args.path);
        await entry.delete(args.recursive);
    }
});

const app = subcommands({
    name: "bunnyctl",
    cmds: { cat, diff, ls, rm }
});

async function runCLI(args: string[]) {
    try {
        await run(app, args);
    } catch (ex) {
        // eslint-disable-next-line
        console.error(ex.toString());
        process.exit(1);
    }
}

void runCLI(process.argv.slice(2));
