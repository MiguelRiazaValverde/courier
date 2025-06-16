
import { FileData, FileSlices, FileVault } from "./file";

class Mode {
    constructor(callback) {
        this.callback = callback;
    }

    packet(_rawData) { }
}

class ModeObject extends Mode {
    packet(rawData) {
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(rawData);
        this.callback(JSON.parse(text));
    }
}

class ModeFile extends Mode {
    constructor(callback, n) {
        super(callback);
        this.n = n;
        this.slices = [];
    }

    packet(rawData) {
        this.slices.push(rawData);
        if (this.slices.length >= this.n)
            this.callback(this.slices);
    }
}




export default class P2P extends EventTarget {
    static SIGNAL = "signal";
    static FILE_ADDED = "file-added";
    static FILE_REMOVED = "file-removed";
    static FILE_PROGRESS = "file-progress";
    static CLOSED = "closed";
    static CONNECT = "connect";
    // static FILE_SENDING = "file-sending";


    constructor(files, initiator) {
        super();

        const peer = new SimplePeer({
            initiator,
            trickle: false,
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        peer.on("signal", data => {
            this.dispatchEvent(new CustomEvent(P2P.SIGNAL, { detail: data }));
        });

        peer.on("connect", () => {
            this.dispatchEvent(new CustomEvent(P2P.CONNECT, { detail: this }));
        });

        peer.on("data", data => {

            if (this.mode) {
                this.mode.packet(data);
            } else {
                const decoder = new TextDecoder('utf-8');
                const text = decoder.decode(data);
                const object = JSON.parse(text);
                if (object.type === "object")
                    this.modeObject();
                else
                    this.modeFile(object);
            }
        });

        peer.on("close", () => {
            this.dispatchEvent(new CustomEvent("closed"));
        });

        peer.on("error", err => { });

        this.files = files;
        this.downloading = {};
        this.availableFiles = new FileVault();

        this.peer = peer;
        this.filesToSend = [];
        this.messagesToSend = [];

        this.mode = null;

        this.sendingPromise = null;

        this.onFileRemoved(fileDesc => delete this.downloading[fileDesc.name]);
        this.onConnect(() => {
            for (const file of this.files)
                this.notifyFileAdd({ name: file.name, fileType: file.type, size: file.size });
        });

        this.availableFiles.onAdd(file => {
            this.dispatchEvent(new CustomEvent(P2P.FILE_ADDED, { detail: file }));
        });

        this.availableFiles.onRemove(file => {
            this.dispatchEvent(new CustomEvent(P2P.FILE_REMOVED, { detail: file }));
        });

        this.files.onAdd(file => {
            this.notifyFileAdd({ name: file.name, fileType: file.type, size: file.size });
        });

        this.files.onRemove(file => {
            this.notifyFileRemove({ name: file.name, fileType: file.type, size: file.size });
        });
    }

    download(fileDesc) {
        if (this.downloading[fileDesc.name])
            return;
        this.downloading[fileDesc.name] = new FileSlices();
        this.message({ type: FileData.DOWNLOAD_EVENT, ...fileDesc });
    }

    modeObject() {
        this.mode = new ModeObject(obj => {
            this.mode = null;

            switch (obj.type) {
                case FileData.ADDED_EVENT:
                    this.availableFiles.add(obj.name, {
                        name: obj.name,
                        fileType: obj.fileType,
                        size: obj.size
                    });
                    break;
                case FileData.REMOVED_EVENT:
                    this.availableFiles.remove(obj.name);
                    break;
                case FileData.DOWNLOAD_EVENT:
                    const fileData = this.files.get(obj.name);
                    if (fileData)
                        this.file(fileData);
                    break;
            }
        });
    }

    modeFile(object) {
        this.mode = new ModeFile(slices => {
            this.mode = null;

            const fileSlices = this.downloading[object.name];
            if (fileSlices) {
                fileSlices.append(slices);

                const done = fileSlices.length >= object.total;
                let fileData = null;

                if (done) {
                    delete this.downloading[object.name];
                    fileData = fileSlices.getFileData(object.name, object.fileType);
                    fileData.download();
                }

                const progress = object.current / object.total;
                fileSlices.progress = progress;

                this.dispatchEvent(new CustomEvent(P2P.FILE_PROGRESS, {
                    detail: {
                        progress,
                        name: object.name,
                        done,
                        fileData
                    }
                }));
            }
        }, object.slices);
    }

    message(object) {
        this.messagesToSend.push(object);
        this.initSend();
    }

    file(fileData) {
        this.filesToSend.push(fileData.chunker());
        this.initSend();
    }

    signal(signal) {
        this.peer.signal(signal);
    }

    async sendObject(object) {
        await this.ensureBufferSize();
        this.peer.write(JSON.stringify({ type: "object" }));
        this.peer.write(JSON.stringify(object));
    }

    async sendSlices(slices, name, current, total) {
        this.peer.write(JSON.stringify({ type: "slices", name, slices: slices.length, current, total }));
        for (const slice of slices) {
            await this.ensureBufferSize();
            this.peer.write(slice);
        }
    }

    async ensureBufferSize() {
        while (this.peer?._channel?.bufferedAmount > 1_000_000) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    async initSend() {
        if (this.sendingPromise)
            return;

        this.sendingPromise = new Promise(async solve => {
            while (this.messagesToSend.length || this.filesToSend.length) {
                for (const message of this.messagesToSend.splice(0, this.messagesToSend.length))
                    await this.sendObject(message);


                const file = this.filesToSend[0];

                if (!file) continue;

                const chunks = [];
                for (let i = 0; i < 100; i++) {
                    const chunk = await file.nextChunk();
                    if (chunk)
                        chunks.push(chunk);
                    else {
                        this.filesToSend.shift();
                        break;
                    }
                }

                await this.sendSlices(chunks, file.fileData.name, file.current, file.totalChunks);
            }
            this.sendingPromise = null;
            solve();
        });
    }

    notifyFileAdd(fileDesc) {
        this.message({ type: FileData.ADDED_EVENT, ...fileDesc });
    }

    notifyFileRemove(fileDesc) {
        this.message({ type: FileData.REMOVED_EVENT, ...fileDesc });
    }

    onSignal(callback) {
        this.addEventListener(P2P.SIGNAL, event => callback(event.detail));
    }

    onFileAdded(callback) {
        this.addEventListener(P2P.FILE_ADDED, event => callback(event.detail));
    }

    onFileRemoved(callback) {
        this.addEventListener(P2P.FILE_REMOVED, event => callback(event.detail));
    }

    onFileProgress(callback) {
        this.addEventListener(P2P.FILE_PROGRESS, event => callback(event.detail));
    }

    onClose(callback) {
        this.addEventListener(P2P.CLOSED, event => callback(event.detail));
    }

    onConnect(callback) {
        this.addEventListener(P2P.CONNECT, event => callback(event.detail));
    }
}

