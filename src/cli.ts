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
import { type BunnyListing } from "./storage.js";
import { hexToArray } from "./util.js";
import * as Algorithms from "./storage-algorithms.js";
import { configParser, getStorage, recursive, typedPath } from "./cli/util.js";

const ls = command({
    name: "ls",
    args: {
        path: positional({
            type: string,
            displayName: "REMOTE-PATH"
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
            displayName: "REMOTE-PATH"
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
        recursive,
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
            displayName: "REMOTE-PATH"
        }),
        recursive,
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        const entry = await Algorithms.loadPath(storage, args.path);
        await entry.delete(args.recursive);
    }
});

const cp = command({
    name: "cp",
    args: {
        path1: positional({
            type: typedPath("local")
        }),
        path2: positional({
            type: typedPath("remote")
        }),
        recursive,
        overwrite: flag({
            type: boolean,
            long: "overwrite",
            short: "o"
        }),
        ...configParser
    },
    handler: async args => {
        const { path1, path2 } = args;
        if (path1.type == path2.type)
            throw new Error("Specify a local and a remote path");

        const storage = getStorage(args);

        let count = 0;

        const options: Algorithms.CopyOptions = {
            overwrite: args.overwrite,
            recursive: args.recursive,
            // eslint-disable-next-line @typescript-eslint/require-await
            async progress(entry, changed) {
                let prefix: string;
                if (changed) {
                    prefix = "🔁";
                    ++count;
                } else prefix = "🟰";
                console.log(`[${prefix}] ${entry.format(true)}`);
            }
        };

        if (path1.type == "local") {
            // we gotta upload
            await Algorithms.uploadPath(
                storage,
                path1.path,
                path2.path,
                options
            );
            console.log(`Uploaded ${count} changed file(s)`);
        } else {
            // we gotta download
            throw new Error("lol");
        }
    }
});

const app = subcommands({
    name: "bunnyctl",
    cmds: { cat, diff, ls, rm, cp }
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
