interface Strings {
    child: string;
    spacer: string;
}

const strings = {
    child: "├─",
    spacer: "| ",
}

const lastStrings = {
    child: "└─",
    spacer: " "
};

function prefixForChild(array: string[], strings: Strings): string[] {
    const [head, ...tail] = array;
    return [
        strings.child + head,
        ...tail.map(t => strings.spacer + t)
    ];
}

export class Tree<T> {
    constructor(
        readonly value: T,
        readonly children: Tree<T>[] = []
    ) { }


    format(fn: (t: T) => string): string[] {
        const self = fn(this.value);
        if (this.children.length == 0)
            return [self];

        const childrens = this.children.map(child => child.format(fn));

        const lastChild = childrens.pop();

        return [
            self,
            ...childrens.flatMap(array => prefixForChild(array, strings)),
            ...prefixForChild(lastChild, lastStrings)
        ];
    }

}