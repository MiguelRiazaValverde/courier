

export class FileChunker {
    constructor(fileData, chunkSizeKB = 64) {
        this.fileData = fileData;
        this.file = fileData.file;
        this.chunkSize = chunkSizeKB * 1024;
        this.offset = 0;
        this.totalChunks = Math.max(Math.ceil(this.file.length / this.chunkSize), 1);
        this.current = 0;
    }

    async nextChunk() {
        if (this.offset >= this.file.length) return null;

        const chunk = this.file.subarray(this.offset, this.offset + this.chunkSize);
        this.offset += this.chunkSize;
        this.current++;
        return chunk;
    }
};


export class FileData {
    static ADDED_EVENT = "file-added";
    static REMOVED_EVENT = "file-removed";
    static DOWNLOAD_EVENT = "file-download";

    constructor(name, type, file) {
        this.name = name;
        this.type = type;
        this.file = file;
        this.size = file.length;
    }

    async download() {
        const blob = new Blob([this.file], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = this.name;
        document.body.appendChild(a);

        a.click();

        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 100);
    }

    chunker() {
        return new FileChunker(this, 16);
    }
};


export class FileSlices {
    constructor() {
        this.slices = [];
        this.progress = 0;
    }

    append(slices) {
        for (const slice of slices)
            this.slices.push(slice);
    }

    getFileData(name, type) {
        let totalLength = this.slices.reduce((acc, val) => acc + val.length, 0);
        let result = new Uint8Array(totalLength);
        let offset = 0;

        for (const arr of this.slices) {
            result.set(arr, offset);
            offset += arr.length;
        }

        return new FileData(name, type, result);
    }

    get length() {
        return this.slices.length;
    }
}


export class FileVault extends EventTarget {
    static ADDED = "added";
    static REMOVED = "removed";

    constructor() {
        super();
        this.files = {};
    }

    get(key) {
        return this.files[key];
    }

    add(key, file) {
        this.remove(key);
        this.files[key] = file;
        this.dispatchEvent(new CustomEvent(FileVault.ADDED, { detail: file }));
    }

    remove(key) {
        const file = this.files[key];
        if (file) {
            delete this.files[key];
            this.dispatchEvent(new CustomEvent(FileVault.REMOVED, { detail: file }));
        }
    }

    onAdd(callback) {
        this.addEventListener(FileVault.ADDED, event => callback(event.detail));
    }

    onRemove(callback) {
        this.addEventListener(FileVault.REMOVED, event => callback(event.detail));
    }

    [Symbol.iterator]() {
        return Object.values(this.files)[Symbol.iterator]();
    }
}